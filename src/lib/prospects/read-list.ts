import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ProspectListMembershipRow,
  ProspectMembershipStage,
  ProspectRow,
} from "@/lib/prospects/types";

export type ProspectListMemberQuery = {
  listId: string;
  q?: string;
  assignedUserId?: string | null;
  unassignedOnly?: boolean;
  stage?: ProspectMembershipStage | null;
  industry?: string | null;
  prefecture?: string | null;
  duplicateReview?: boolean;
  dncOnly?: boolean;
  formalMatchOnly?: boolean;
  page?: number;
  pageSize?: number;
  sort?: "updated_at" | "company_name";
};

export type ProspectListMemberItem = {
  membership: ProspectListMembershipRow;
  prospect: ProspectRow;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
};

export async function queryProspectListMembers(
  input: ProspectListMemberQuery,
): Promise<{ items: ProspectListMemberItem[]; total: number }> {
  const admin = createAdminClient();
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Filter prospects first when needed, then memberships (typed schema has no FK embeds)
  let prospectFilterIds: string[] | null = null;
  const needsProspectFilter =
    Boolean(input.q?.trim()) ||
    Boolean(input.industry) ||
    Boolean(input.prefecture) ||
    Boolean(input.duplicateReview) ||
    Boolean(input.dncOnly) ||
    Boolean(input.formalMatchOnly);

  if (needsProspectFilter) {
    let pq = admin
      .from("prospects")
      .select("id")
      .is("archived_at", null);
    if (input.industry) pq = pq.eq("industry", input.industry);
    if (input.prefecture) pq = pq.eq("prefecture", input.prefecture);
    if (input.duplicateReview) {
      pq = pq.eq("duplicate_review_status", "probable");
    }
    if (input.dncOnly) pq = pq.eq("do_not_contact", true);
    if (input.formalMatchOnly) {
      pq = pq.not("formal_org_match_page_id", "is", null);
    }
    if (input.q?.trim()) {
      const q = input.q.trim().replace(/[%_]/g, "");
      pq = pq.ilike("search_text", `%${q}%`);
    }
    const { data: pRows, error: pErr } = await pq.limit(5000);
    if (pErr) throw new Error(pErr.message);
    prospectFilterIds = (pRows ?? []).map((r) => String(r.id));
    if (prospectFilterIds.length === 0) {
      return { items: [], total: 0 };
    }
  }

  let memQ = admin
    .from("prospect_list_memberships")
    .select("*", { count: "exact" })
    .eq("prospect_list_id", input.listId)
    .is("archived_at", null);

  if (prospectFilterIds) {
    memQ = memQ.in("prospect_id", prospectFilterIds);
  }
  if (input.assignedUserId) {
    memQ = memQ.eq("assigned_user_id", input.assignedUserId);
  }
  if (input.unassignedOnly) {
    memQ = memQ.is("assigned_user_id", null);
  }
  if (input.stage) {
    memQ = memQ.eq("stage", input.stage);
  }

  memQ = memQ.order("updated_at", { ascending: false });

  const { data, error, count } = await memQ.range(from, to);
  if (error) throw new Error(error.message);

  const memberships = (data ?? []) as unknown as ProspectListMembershipRow[];
  const prospectIds = memberships.map((r) => r.prospect_id);

  const prospectById = new Map<string, ProspectRow>();
  const contactByProspect = new Map<
    string,
    { name: string; email: string | null }
  >();
  if (prospectIds.length > 0) {
    const { data: prospects, error: pe } = await admin
      .from("prospects")
      .select("*")
      .in("id", prospectIds)
      .is("archived_at", null);
    if (pe) throw new Error(pe.message);
    for (const p of (prospects ?? []) as unknown as ProspectRow[]) {
      prospectById.set(p.id, p);
    }
    const { data: contacts } = await admin
      .from("prospect_contacts")
      .select("prospect_id,name,email,is_primary")
      .in("prospect_id", prospectIds)
      .is("archived_at", null)
      .order("is_primary", { ascending: false });
    for (const c of contacts ?? []) {
      const pid = String(c.prospect_id);
      if (!contactByProspect.has(pid)) {
        contactByProspect.set(pid, {
          name: String(c.name),
          email: (c.email as string | null) ?? null,
        });
      }
    }
  }

  let items: ProspectListMemberItem[] = memberships
    .map((membership) => {
      const prospect = prospectById.get(membership.prospect_id);
      if (!prospect) return null;
      const contact = contactByProspect.get(membership.prospect_id);
      return {
        membership,
        prospect,
        primaryContactName: contact?.name ?? null,
        primaryContactEmail: contact?.email ?? null,
      };
    })
    .filter((x): x is ProspectListMemberItem => Boolean(x));

  if (input.sort === "company_name") {
    items = items.sort((a, b) =>
      a.prospect.company_name.localeCompare(b.prospect.company_name, "ja"),
    );
  }

  return { items, total: count ?? 0 };
}

export type ProspectPoolQuery = {
  q?: string;
  dncOnly?: boolean;
  formalMatchOnly?: boolean;
  duplicateReview?: boolean;
  page?: number;
  pageSize?: number;
};

export async function queryProspectPool(
  input: ProspectPoolQuery,
): Promise<{ items: ProspectRow[]; total: number }> {
  const admin = createAdminClient();
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = admin
    .from("prospects")
    .select("*", { count: "exact" })
    .is("archived_at", null);

  if (input.dncOnly) q = q.eq("do_not_contact", true);
  if (input.formalMatchOnly) q = q.not("formal_org_match_page_id", "is", null);
  if (input.duplicateReview) q = q.eq("duplicate_review_status", "probable");
  if (input.q?.trim()) {
    const term = input.q.trim().replace(/[%_]/g, "");
    q = q.ilike("search_text", `%${term}%`);
  }

  const { data, error, count } = await q
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return { items: (data ?? []) as ProspectRow[], total: count ?? 0 };
}
