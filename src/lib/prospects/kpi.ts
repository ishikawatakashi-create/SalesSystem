import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 13B KPI definitions (unique-prospect based rates).
 *
 * attempt_count:
 *   raw call_attempts in period (membership scoped to list)
 *
 * attempted_prospect_count:
 *   unique prospects with ≥1 attempt in period
 *
 * connected_prospect_count:
 *   unique prospects with connected-class result
 *   (connected|send_materials|interested|appointment|not_interested|do_not_contact)
 *
 * connection_rate:
 *   connected_prospect_count / attempted_prospect_count
 *
 * appointment_rate:
 *   unique prospects with appointment / connected_prospect_count
 */

export type CallKpiPeriod = "today" | "7d" | "30d" | "all";

export type ListCallKpi = {
  prospectListId: string;
  attemptCount: number;
  attemptedProspectCount: number;
  connectedProspectCount: number;
  interestedProspectCount: number;
  appointmentProspectCount: number;
  disqualifiedProspectCount: number;
  dncProspectCount: number;
  connectionRate: number | null;
  appointmentRate: number | null;
};

export function periodToRange(period: CallKpiPeriod): {
  from: string | null;
  to: string | null;
} {
  if (period === "all") return { from: null, to: null };
  const now = new Date();
  const to = now.toISOString();
  if (period === "today") {
    const jst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return { from: new Date(`${jst}T00:00:00+09:00`).toISOString(), to };
  }
  const days = period === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  return { from, to };
}

export async function fetchListCallKpis(input: {
  listIds: string[];
  period?: CallKpiPeriod;
}): Promise<ListCallKpi[]> {
  if (input.listIds.length === 0) return [];
  const { from, to } = periodToRange(input.period ?? "all");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("prospect_list_call_stats", {
    p_list_ids: input.listIds,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const attempted = Number(row.attempted_prospect_count ?? 0);
    const connected = Number(row.connected_prospect_count ?? 0);
    const appointment = Number(row.appointment_prospect_count ?? 0);
    return {
      prospectListId: String(row.prospect_list_id),
      attemptCount: Number(row.attempt_count ?? 0),
      attemptedProspectCount: attempted,
      connectedProspectCount: connected,
      interestedProspectCount: Number(row.interested_prospect_count ?? 0),
      appointmentProspectCount: appointment,
      disqualifiedProspectCount: Number(row.disqualified_prospect_count ?? 0),
      dncProspectCount: Number(row.dnc_prospect_count ?? 0),
      connectionRate: attempted > 0 ? connected / attempted : null,
      appointmentRate: connected > 0 ? appointment / connected : null,
    };
  });
}

export function formatRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}
