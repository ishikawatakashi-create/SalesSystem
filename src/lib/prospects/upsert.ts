import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeProspectAudit } from "@/lib/prospects/audit";
import {
  findProspectDedupeMatches,
  pickHighConfidenceReuse,
} from "@/lib/prospects/dedupe";
import {
  applyFormalMatchToProspect,
  findFormalOrganizationMatches,
} from "@/lib/prospects/formal-match";
import {
  normalizePersonNameForCompare,
  stagedToNormalized,
} from "@/lib/prospects/normalize";
import type {
  ProspectImportRowStatus,
  ProspectStagedRow,
} from "@/lib/prospects/types";

export type UpsertProspectFromImportResult = {
  status: ProspectImportRowStatus;
  prospectId: string | null;
  membershipId: string | null;
  matchReason: string | null;
  errorMessage: string | null;
};

/**
 * Import one staged row into Prospect Pool + list membership.
 * Never writes Notion.
 */
export async function upsertProspectFromImport(input: {
  listId: string;
  staged: ProspectStagedRow;
  actorId: string;
  actorName: string;
  importJobId?: string;
}): Promise<UpsertProspectFromImportResult> {
  const company = input.staged.companyName?.trim();
  if (!company) {
    return {
      status: "invalid",
      prospectId: null,
      membershipId: null,
      matchReason: null,
      errorMessage: "会社名は必須です",
    };
  }

  const admin = createAdminClient();
  const { core, contact, sourceRowHash, sourceAttributes } = stagedToNormalized({
    ...input.staged,
    companyName: company,
  });

  // Idempotency: same list + source_row_hash
  const { data: existingMem } = await admin
    .from("prospect_list_memberships")
    .select("id,prospect_id")
    .eq("prospect_list_id", input.listId)
    .eq("source_row_hash", sourceRowHash)
    .is("archived_at", null)
    .maybeSingle();
  if (existingMem) {
    return {
      status: "skipped",
      prospectId: existingMem.prospect_id as string,
      membershipId: existingMem.id as string,
      matchReason: "source_row_hash",
      errorMessage: null,
    };
  }

  const matches = await findProspectDedupeMatches({
    normalizedDomain: core.normalizedDomain,
    normalizedPhone: core.normalizedPhone,
    normalizedCompanyName: core.normalizedCompanyName,
    prefecture: core.prefecture,
    city: core.city,
    contactNormalizedEmail: contact.normalizedEmail,
  });
  const high = pickHighConfidenceReuse(matches);
  const probable = matches.find((m) => m.kind === "probable");

  let prospectId: string;
  let status: ProspectImportRowStatus = "accepted";
  let matchReason: string | null = null;

  if (high) {
    prospectId = high.prospect.id;
    status = "reused";
    matchReason = `high:${high.reason}`;
  } else {
    const { data: created, error } = await admin
      .from("prospects")
      .insert({
        company_name: core.companyName,
        normalized_company_name: core.normalizedCompanyName,
        website_url: core.websiteUrl,
        normalized_domain: core.normalizedDomain,
        main_phone: core.mainPhone,
        normalized_phone: core.normalizedPhone,
        postal_code: core.postalCode,
        prefecture: core.prefecture,
        city: core.city,
        address: core.address,
        industry: core.industry,
        employee_range: core.employeeRange,
        notes: input.staged.notes,
        search_text: core.searchText,
        duplicate_review_status: probable ? "probable" : "none",
        created_by: input.actorId,
      })
      .select("id")
      .single();
    if (error || !created) {
      return {
        status: "failed",
        prospectId: null,
        membershipId: null,
        matchReason: null,
        errorMessage: error?.message ?? "prospect create failed",
      };
    }
    prospectId = created.id as string;
    if (probable) {
      status = "probable_duplicate";
      matchReason = `probable:${probable.reason}:${probable.prospect.id}`;
    }

    await writeProspectAudit({
      actorId: input.actorId,
      actorName: input.actorName,
      action: "prospect.created",
      entityType: "prospect",
      entityId: prospectId,
      changedFields: {
        company_name: core.companyName,
        import_job_id: input.importJobId ?? null,
      },
    });
  }

  // Membership (unique active)
  const { data: memExisting } = await admin
    .from("prospect_list_memberships")
    .select("id")
    .eq("prospect_list_id", input.listId)
    .eq("prospect_id", prospectId)
    .is("archived_at", null)
    .maybeSingle();

  let membershipId: string;
  if (memExisting) {
    membershipId = memExisting.id as string;
    await admin
      .from("prospect_list_memberships")
      .update({
        source_row_hash: sourceRowHash,
        source_record_id: input.staged.externalRecordId,
        source_attributes: sourceAttributes,
      })
      .eq("id", membershipId);
    if (status === "accepted") status = "reused";
  } else {
    const { data: mem, error: memErr } = await admin
      .from("prospect_list_memberships")
      .insert({
        prospect_list_id: input.listId,
        prospect_id: prospectId,
        stage: "new",
        source_record_id: input.staged.externalRecordId,
        source_row_hash: sourceRowHash,
        source_attributes: sourceAttributes,
        notes: input.staged.notes,
      })
      .select("id")
      .single();
    if (memErr || !mem) {
      return {
        status: "failed",
        prospectId,
        membershipId: null,
        matchReason,
        errorMessage: memErr?.message ?? "membership create failed",
      };
    }
    membershipId = mem.id as string;
    await writeProspectAudit({
      actorId: input.actorId,
      actorName: input.actorName,
      action: "prospect_membership.added",
      entityType: "prospect_membership",
      entityId: membershipId,
      changedFields: {
        prospect_id: prospectId,
        prospect_list_id: input.listId,
      },
    });
  }

  // Contact (add if new email/phone/name)
  if (contact.name) {
    const { data: existingContacts } = await admin
      .from("prospect_contacts")
      .select("id,normalized_email,normalized_phone,normalized_name")
      .eq("prospect_id", prospectId)
      .is("archived_at", null);
    const normName = normalizePersonNameForCompare(contact.name);
    const dup = (existingContacts ?? []).some((c) => {
      if (
        contact.normalizedEmail &&
        c.normalized_email === contact.normalizedEmail
      ) {
        return true;
      }
      if (
        contact.normalizedPhone &&
        c.normalized_phone === contact.normalizedPhone
      ) {
        return true;
      }
      return c.normalized_name === normName && !contact.normalizedEmail;
    });
    if (!dup) {
      const isPrimary = (existingContacts ?? []).length === 0;
      await admin.from("prospect_contacts").insert({
        prospect_id: prospectId,
        name: contact.name,
        normalized_name: normName,
        department: contact.department,
        title: contact.title,
        email: contact.email,
        normalized_email: contact.normalizedEmail,
        phone: contact.phone,
        normalized_phone: contact.normalizedPhone,
        is_primary: isPrimary,
      });
    }
  }

  // Formal org match (detect only)
  const formal = await findFormalOrganizationMatches({
    normalizedDomain: core.normalizedDomain,
    normalizedPhone: core.normalizedPhone,
  });
  if (formal[0]) {
    await applyFormalMatchToProspect(prospectId, formal[0]);
  }

  return {
    status,
    prospectId,
    membershipId,
    matchReason,
    errorMessage: null,
  };
}
