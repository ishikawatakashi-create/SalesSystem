export const CALL_QUEUE_FILTERS = [
  "eligible",
  "overdue",
  "today",
  "no_schedule",
  "all",
] as const;

export type CallQueueFilter = (typeof CALL_QUEUE_FILTERS)[number];

export function normalizeCallQueueFilter(value: unknown): CallQueueFilter {
  switch (value) {
    case "overdue":
    case "today":
    case "no_schedule":
    case "all":
      return value;
    case "eligible":
    default:
      return "eligible";
  }
}
