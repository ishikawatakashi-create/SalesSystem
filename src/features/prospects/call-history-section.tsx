import Link from "next/link";

import { listCallAttempts } from "@/lib/prospects/call-attempts";
import { CALL_RESULT_LABELS, type CallResult } from "@/lib/prospects/call-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/features/customers/format";

export async function CallHistorySection(props: {
  prospectId: string;
  cursorCompletedAt?: string | null;
  cursorId?: string | null;
}) {
  const { items, nextCursor } = await listCallAttempts({
    prospectId: props.prospectId,
    limit: 20,
    cursorCompletedAt: props.cursorCompletedAt,
    cursorId: props.cursorId,
  });

  const performerIds = [
    ...new Set(
      items
        .map((i) => i.performed_by as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const membershipIds = [
    ...new Set(
      items
        .map((i) => i.membership_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const admin = createAdminClient();
  const names = new Map<string, string>();
  if (performerIds.length > 0) {
    const { data } = await admin
      .from("app_users")
      .select("id,display_name")
      .in("id", performerIds);
    for (const u of data ?? []) {
      names.set(String(u.id), String(u.display_name));
    }
  }
  const listByMembership = new Map<string, string>();
  if (membershipIds.length > 0) {
    const { data: mems } = await admin
      .from("prospect_list_memberships")
      .select("id,prospect_list_id")
      .in("id", membershipIds);
    const listIds = [
      ...new Set((mems ?? []).map((m) => String(m.prospect_list_id))),
    ];
    const listNames = new Map<string, string>();
    if (listIds.length > 0) {
      const { data: lists } = await admin
        .from("prospect_lists")
        .select("id,name")
        .in("id", listIds);
      for (const l of lists ?? []) {
        listNames.set(String(l.id), String(l.name));
      }
    }
    for (const m of mems ?? []) {
      listByMembership.set(
        String(m.id),
        listNames.get(String(m.prospect_list_id)) ?? "リスト",
      );
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-800">接触履歴</h2>
      {items.length === 0 ? (
        <p className="text-slate-500">履歴なし</p>
      ) : (
        <ul className="divide-y rounded border border-slate-200 bg-white">
          {items.map((a) => (
            <li key={String(a.id)} className="px-3 py-2">
              <div className="flex flex-wrap gap-2">
                <span className="font-medium">
                  {CALL_RESULT_LABELS[a.result as CallResult] ??
                    String(a.result)}
                </span>
                <span className="text-slate-500">
                  {formatDateTime(String(a.completed_at))}
                </span>
                <span className="text-slate-600">
                  {names.get(String(a.performed_by)) ?? "担当者"}
                </span>
                {a.membership_id ? (
                  <span className="text-slate-500">
                    {listByMembership.get(String(a.membership_id)) ?? ""}
                  </span>
                ) : null}
              </div>
              {a.note ? (
                <p className="mt-0.5 whitespace-pre-wrap text-slate-700">
                  {String(a.note)}
                </p>
              ) : null}
              {a.next_contact_at ? (
                <p className="text-slate-500">
                  次回: {formatDateTime(String(a.next_contact_at))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Link
          href={`/prospects/${props.prospectId}?histAt=${encodeURIComponent(nextCursor.completedAt)}&histId=${encodeURIComponent(nextCursor.id)}`}
          className="text-slate-600 underline"
        >
          さらに表示
        </Link>
      ) : null}
    </section>
  );
}
