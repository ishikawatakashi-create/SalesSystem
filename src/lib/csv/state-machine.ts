/**
 * インポートジョブのステータス遷移管理。
 *
 * @see docs/csv-import-design.md §2, docs/supabase-schema.md §9
 */

export const IMPORT_JOB_STATUSES = [
  "uploaded",
  "parsing",
  "mapping_required",
  "validating",
  "ready",
  "importing",
  "completed",
  "failed",
  "cancelled",
  "partially_completed",
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

type TransitionRule = {
  from: ImportJobStatus;
  to: ImportJobStatus[];
};

const TRANSITION_RULES: TransitionRule[] = [
  {
    from: "uploaded",
    to: ["parsing", "mapping_required", "failed", "cancelled"],
  },
  { from: "parsing", to: ["mapping_required", "failed", "cancelled"] },
  {
    from: "mapping_required",
    to: ["validating", "failed", "cancelled"],
  },
  { from: "validating", to: ["ready", "failed", "cancelled"] },
  { from: "ready", to: ["importing", "validating", "cancelled"] },
  {
    from: "importing",
    to: ["completed", "failed", "partially_completed", "cancelled"],
  },
  { from: "completed", to: [] },
  {
    from: "failed",
    to: ["importing", "validating", "mapping_required", "cancelled"],
  },
  { from: "partially_completed", to: ["importing", "cancelled"] },
  { from: "cancelled", to: [] },
];

export function canTransition(
  from: ImportJobStatus,
  to: ImportJobStatus,
): boolean {
  const rule = TRANSITION_RULES.find((r) => r.from === from);
  return rule ? rule.to.includes(to) : false;
}

export function assertTransition(
  from: ImportJobStatus,
  to: ImportJobStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `無効なステータス遷移: ${from} → ${to}（許可されていません）`,
    );
  }
}

export function isTerminalStatus(status: ImportJobStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function canRetry(status: ImportJobStatus): boolean {
  return status === "failed" || status === "partially_completed";
}
