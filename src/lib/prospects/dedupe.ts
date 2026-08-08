import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ProspectRow } from "@/lib/prospects/types";

export type DedupeMatch =
  | {
      kind: "high";
      reason: "domain" | "phone" | "contact_email";
      prospect: ProspectRow;
    }
  | {
      kind: "probable";
      reason: "company_name" | "company_name_location";
      prospect: ProspectRow;
    };

/**
 * High-confidence auto-reuse only:
 * - exact normalized domain
 * - exact normalized company phone
 * - exact contact email (via prospect_contacts)
 *
 * Company-name-only → probable (no auto merge).
 */
export async function findProspectDedupeMatches(input: {
  normalizedDomain: string | null;
  normalizedPhone: string | null;
  normalizedCompanyName: string;
  prefecture?: string | null;
  city?: string | null;
  contactNormalizedEmail?: string | null;
  excludeProspectId?: string | null;
}): Promise<DedupeMatch[]> {
  const admin = createAdminClient();
  const matches: DedupeMatch[] = [];
  const seen = new Set<string>();

  const push = (m: DedupeMatch) => {
    if (seen.has(m.prospect.id)) return;
    if (input.excludeProspectId && m.prospect.id === input.excludeProspectId) {
      return;
    }
    seen.add(m.prospect.id);
    matches.push(m);
  };

  if (input.normalizedDomain) {
    const { data } = await admin
      .from("prospects")
      .select("*")
      .eq("normalized_domain", input.normalizedDomain)
      .is("archived_at", null)
      .limit(5);
    for (const row of (data ?? []) as ProspectRow[]) {
      push({ kind: "high", reason: "domain", prospect: row });
    }
  }

  if (input.normalizedPhone) {
    const { data } = await admin
      .from("prospects")
      .select("*")
      .eq("normalized_phone", input.normalizedPhone)
      .is("archived_at", null)
      .limit(5);
    for (const row of (data ?? []) as ProspectRow[]) {
      push({ kind: "high", reason: "phone", prospect: row });
    }
  }

  if (input.contactNormalizedEmail) {
    const { data: contacts } = await admin
      .from("prospect_contacts")
      .select("prospect_id")
      .eq("normalized_email", input.contactNormalizedEmail)
      .is("archived_at", null)
      .limit(5);
    const ids = [...new Set((contacts ?? []).map((c) => c.prospect_id as string))];
    if (ids.length > 0) {
      const { data } = await admin
        .from("prospects")
        .select("*")
        .in("id", ids)
        .is("archived_at", null);
      for (const row of (data ?? []) as ProspectRow[]) {
        push({ kind: "high", reason: "contact_email", prospect: row });
      }
    }
  }

  // Company name only → probable (never high)
  if (input.normalizedCompanyName && matches.every((m) => m.kind !== "high")) {
    const { data } = await admin
      .from("prospects")
      .select("*")
      .eq("normalized_company_name", input.normalizedCompanyName)
      .is("archived_at", null)
      .limit(10);
    for (const row of (data ?? []) as ProspectRow[]) {
      const locBoost =
        Boolean(input.prefecture) &&
        Boolean(row.prefecture) &&
        input.prefecture === row.prefecture &&
        (!input.city || !row.city || input.city === row.city);
      push({
        kind: "probable",
        reason: locBoost ? "company_name_location" : "company_name",
        prospect: row,
      });
    }
  }

  // Prefer high first
  matches.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "high" ? -1 : 1));
  return matches;
}

export function pickHighConfidenceReuse(
  matches: DedupeMatch[],
): DedupeMatch | null {
  return matches.find((m) => m.kind === "high") ?? null;
}
