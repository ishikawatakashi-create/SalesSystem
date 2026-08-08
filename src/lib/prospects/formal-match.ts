import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDomain } from "@/lib/normalize/domain";

export type FormalOrgMatch = {
  pageId: string;
  externalId: string | null;
  displayName: string;
  confidence: "high" | "probable";
  reason: "domain" | "phone";
};

/**
 * Detect existing formal Organization (customer_index) candidates.
 * Does NOT write Notion or auto-promote.
 */
export async function findFormalOrganizationMatches(input: {
  normalizedDomain: string | null;
  normalizedPhone: string | null;
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
      .select("notion_page_id,external_id,display_name,phone_normalized,website,email")
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
    // website / email may contain domain — fetch recent non-archived and filter in app
    // (no website_domain column). Cap scan for safety.
    const { data } = await admin
      .from("customer_index")
      .select("notion_page_id,external_id,display_name,website,email")
      .eq("is_archived", false)
      .or(
        `website.ilike.%${input.normalizedDomain}%,email.ilike.%@${input.normalizedDomain}`,
      )
      .limit(20);
    for (const row of data ?? []) {
      const siteDom = normalizeDomain(row.website as string | null);
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
