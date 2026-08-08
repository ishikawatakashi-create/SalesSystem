import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDomain } from "@/lib/normalize/domain";
import { normalizeEmailOrNull } from "@/lib/normalize";
import { normalizePhone } from "@/lib/normalize";

export type FormalOrgMatch = {
  pageId: string;
  externalId: string | null;
  displayName: string;
  confidence: "high" | "probable";
  reason: "domain" | "phone" | "contact_email" | "company_name" | "company_address";
};

/**
 * Detect existing formal Organization (customer_index) candidates.
 * Does NOT write Notion or auto-promote.
 *
 * high: exact normalized_domain / phone / formal contact email
 * probable: company name (+ optional address) — never auto-exact
 */
export async function findFormalOrganizationMatches(input: {
  normalizedDomain: string | null;
  normalizedPhone: string | null;
  contactEmails?: string[] | null;
  companyName?: string | null;
  prefecture?: string | null;
  city?: string | null;
}): Promise<FormalOrgMatch[]> {
  const admin = createAdminClient();
  const out: FormalOrgMatch[] = [];
  const seen = new Set<string>();

  const push = (m: FormalOrgMatch) => {
    if (seen.has(m.pageId)) return;
    seen.add(m.pageId);
    out.push(m);
  };

  if (input.normalizedPhone) {
    const { data } = await admin
      .from("customer_index")
      .select(
        "notion_page_id,external_id,display_name,phone_normalized,normalized_domain,website,email",
      )
      .eq("phone_normalized", input.normalizedPhone)
      .eq("is_archived", false)
      .limit(5);
    for (const row of data ?? []) {
      push({
        pageId: String(row.notion_page_id),
        externalId: (row.external_id as string | null) ?? null,
        displayName: String(row.display_name ?? ""),
        confidence: "high",
        reason: "phone",
      });
    }
  }

  if (input.normalizedDomain) {
    const { data } = await admin
      .from("customer_index")
      .select(
        "notion_page_id,external_id,display_name,normalized_domain,website,email",
      )
      .eq("normalized_domain", input.normalizedDomain)
      .eq("is_archived", false)
      .limit(10);
    for (const row of data ?? []) {
      push({
        pageId: String(row.notion_page_id),
        externalId: (row.external_id as string | null) ?? null,
        displayName: String(row.display_name ?? ""),
        confidence: "high",
        reason: "domain",
      });
    }

    // fallback for rows not yet backfilled
    if ((data ?? []).length === 0) {
      const { data: scanned } = await admin
        .from("customer_index")
        .select(
          "notion_page_id,external_id,display_name,normalized_domain,website,email",
        )
        .eq("is_archived", false)
        .or(
          `website.ilike.%${input.normalizedDomain}%,email.ilike.%@${input.normalizedDomain}`,
        )
        .limit(20);
      for (const row of scanned ?? []) {
        const siteDom =
          (row.normalized_domain as string | null) ??
          normalizeDomain(row.website as string | null);
        const emailDom = normalizeDomain(row.email as string | null);
        if (
          siteDom === input.normalizedDomain ||
          emailDom === input.normalizedDomain
        ) {
          push({
            pageId: String(row.notion_page_id),
            externalId: (row.external_id as string | null) ?? null,
            displayName: String(row.display_name ?? ""),
            confidence: "high",
            reason: "domain",
          });
        }
      }
    }
  }

  const emails = (input.contactEmails ?? [])
    .map((e) => normalizeEmailOrNull(e))
    .filter((e): e is string => Boolean(e));
  for (const email of emails.slice(0, 5)) {
    const { data: contacts } = await admin
      .from("contact_index")
      .select("customer_page_id,email")
      .eq("email", email)
      .eq("is_active", true)
      .limit(5);
    const pageIds = [
      ...new Set(
        (contacts ?? [])
          .map((c) => c.customer_page_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (pageIds.length === 0) continue;
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id,external_id,display_name")
      .in("notion_page_id", pageIds)
      .eq("is_archived", false);
    for (const row of customers ?? []) {
      push({
        pageId: String(row.notion_page_id),
        externalId: (row.external_id as string | null) ?? null,
        displayName: String(row.display_name ?? ""),
        confidence: "high",
        reason: "contact_email",
      });
    }
  }

  // probable: company name only / name+address — never high
  const name = input.companyName?.trim();
  if (name && out.filter((m) => m.confidence === "high").length === 0) {
    const { data } = await admin
      .from("customer_index")
      .select(
        "notion_page_id,external_id,display_name,prefecture,city",
      )
      .eq("is_archived", false)
      .ilike("display_name", name)
      .limit(5);
    for (const row of data ?? []) {
      const addrHit =
        Boolean(input.prefecture) &&
        Boolean(input.city) &&
        String(row.prefecture ?? "") === input.prefecture &&
        String(row.city ?? "") === input.city;
      push({
        pageId: String(row.notion_page_id),
        externalId: (row.external_id as string | null) ?? null,
        displayName: String(row.display_name ?? ""),
        confidence: "probable",
        reason: addrHit ? "company_address" : "company_name",
      });
    }
  }

  // high first
  out.sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === "high" ? -1 : 1;
  });
  return out;
}

export async function applyFormalMatchToProspect(
  prospectId: string,
  match: FormalOrgMatch | null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("prospects")
    .update({
      formal_org_match_page_id: match?.pageId ?? null,
      formal_org_match_external_id: match?.externalId ?? null,
      formal_org_match_confidence: match?.confidence ?? null,
    })
    .eq("id", prospectId);
  if (error) throw new Error(error.message);
}

/** Derive normalized_domain for customer_index upsert */
export function deriveCustomerNormalizedDomain(input: {
  website: string | null | undefined;
  email?: string | null | undefined;
}): string | null {
  return (
    normalizeDomain(input.website) ?? normalizeDomain(input.email) ?? null
  );
}

/** Safe phone helper for callers */
export function normalizeMatchPhone(
  phone: string | null | undefined,
): string | null {
  return normalizePhone(phone);
}
