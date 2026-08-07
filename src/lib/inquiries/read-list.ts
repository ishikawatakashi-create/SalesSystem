import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { InquiryRow, InquiryStatus } from "@/lib/inquiries/types";

export type InquiryListQuery = {
  tab?: string;
  q?: string;
  assignedUserId?: string;
  status?: string;
  receivedFrom?: string;
  receivedTo?: string;
  page?: number;
  pageSize?: number;
};

const TAB_STATUSES: Record<string, InquiryStatus[] | null> = {
  new: ["new"],
  in_progress: ["in_progress"],
  done: ["done"],
  no_action: ["no_action"],
  open: ["new", "in_progress"],
  all: null,
};

export async function listInquiries(query: InquiryListQuery): Promise<{
  rows: InquiryRow[];
  total: number;
}> {
  const admin = createAdminClient();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = admin
    .from("inquiries")
    .select("*", { count: "exact" })
    .order("received_at", { ascending: false });

  const tab = query.tab || "open";
  const statuses = TAB_STATUSES[tab] ?? TAB_STATUSES.open;
  if (statuses) {
    q = q.in("status", statuses);
  }
  const statusFilter = query.status as InquiryStatus | "all" | undefined;
  if (
    statusFilter &&
    statusFilter !== "all" &&
    (statusFilter === "new" ||
      statusFilter === "in_progress" ||
      statusFilter === "done" ||
      statusFilter === "no_action")
  ) {
    q = q.eq("status", statusFilter);
  }
  if (query.assignedUserId) {
    if (query.assignedUserId === "__unassigned__") {
      q = q.is("assigned_user_id", null);
    } else {
      q = q.eq("assigned_user_id", query.assignedUserId);
    }
  }
  if (query.receivedFrom) {
    q = q.gte("received_at", `${query.receivedFrom}T00:00:00.000Z`);
  }
  if (query.receivedTo) {
    q = q.lte("received_at", `${query.receivedTo}T23:59:59.999Z`);
  }
  if (query.q?.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(
      `sender_name.ilike.${term},company_name.ilike.${term},sender_email.ilike.${term},subject.ilike.${term},message_text.ilike.${term}`,
    );
  }

  const { data, count, error } = await q.range(from, to);
  if (error) throw new Error("inquiry_list_failed");
  return { rows: (data ?? []) as InquiryRow[], total: count ?? 0 };
}

export async function countNewInquiries(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "new")
    .eq("historical_import", false);
  return count ?? 0;
}

export async function countUnassignedNewInquiries(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "new")
    .eq("historical_import", false)
    .is("assigned_user_id", null);
  return count ?? 0;
}

export async function getInquiryById(id: string): Promise<InquiryRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("inquiries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as InquiryRow | null) ?? null;
}
