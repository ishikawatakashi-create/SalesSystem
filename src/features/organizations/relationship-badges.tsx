import { organizationRelationshipLabel } from "@/lib/organizations/relationship";

export function RelationshipBadges({
  keys,
  empty = "—",
}: {
  keys: string[] | null | undefined;
  empty?: string | null;
}) {
  const list = keys ?? [];
  if (list.length === 0) {
    if (empty == null) return null;
    return <span className="text-slate-400">{empty}</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((key) => (
        <span
          key={key}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
        >
          {organizationRelationshipLabel(key)}
        </span>
      ))}
    </span>
  );
}
