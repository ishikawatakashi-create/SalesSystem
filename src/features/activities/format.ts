/** 対応履歴の表示整形 */

export {
  formatDate,
  formatDateTime,
} from "@/features/customers/format";

export function formatOptional(value: string | null | undefined): string {
  return value?.trim() ? value : "—";
}

/** datetime-local 用(ローカル表示)。ISO → YYYY-MM-DDTHH:mm */
export function toDatetimeLocalValue(
  iso: string | null | undefined,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** datetime-local → ISO(ローカル解釈) */
export function fromDatetimeLocalValue(value: string): string {
  const t = value.trim();
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toISOString();
}
