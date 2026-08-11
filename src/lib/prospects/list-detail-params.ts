export const PROSPECT_LIST_KPI_PERIODS = [
  "today",
  "7d",
  "30d",
  "all",
] as const;

export type ProspectListKpiPeriod =
  (typeof PROSPECT_LIST_KPI_PERIODS)[number];

export type ProspectListDetailSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function parseProspectListKpiPeriod(
  value: string | null | undefined,
): ProspectListKpiPeriod {
  return PROSPECT_LIST_KPI_PERIODS.includes(
    value as ProspectListKpiPeriod,
  )
    ? (value as ProspectListKpiPeriod)
    : "30d";
}

export function parseProspectListPage(
  value: string | null | undefined,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function resolveProspectAssignmentFilter(input: {
  assignedUserId?: string | null;
  unassignedOnly?: boolean;
}): {
  assignedUserId: string | null;
  unassignedOnly: boolean;
} {
  const unassignedOnly = input.unassignedOnly === true;
  const assignedUserId = input.assignedUserId?.trim() || null;
  return {
    assignedUserId: unassignedOnly ? null : assignedUserId,
    unassignedOnly,
  };
}

export function buildProspectListDetailHref(
  current: ProspectListDetailSearchParams,
  patch: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(current)) {
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  return query ? `?${query}` : "?";
}
