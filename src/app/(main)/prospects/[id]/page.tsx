import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROSPECT_STAGE_LABELS } from "@/lib/prospects/types";
import { ProspectDncForm } from "@/features/prospects/dnc-form";
import { formatDateTime } from "@/features/customers/format";

export const dynamic = "force-dynamic";

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "prospect.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!prospect || prospect.archived_at) {
    redirect("/prospects");
  }

  const { data: contacts } = await admin
    .from("prospect_contacts")
    .select("*")
    .eq("prospect_id", id)
    .is("archived_at", null)
    .order("is_primary", { ascending: false });

  const { data: memberships } = await admin
    .from("prospect_list_memberships")
    .select("*")
    .eq("prospect_id", id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  const listIds = [
    ...new Set((memberships ?? []).map((m) => String(m.prospect_list_id))),
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

  const assigneeIds = [
    ...new Set(
      (memberships ?? [])
        .map((m) => m.assigned_user_id as string | null)
        .filter(Boolean),
    ),
  ] as string[];
  const assigneeNames = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: users } = await admin
      .from("app_users")
      .select("id,display_name")
      .in("id", assigneeIds);
    for (const u of users ?? []) {
      assigneeNames.set(String(u.id), String(u.display_name));
    }
  }

  const canEdit = hasPermission(user.role, "prospect.edit");

  return (
    <div className="space-y-4 text-xs">
      <div>
        <Link href="/prospects" className="text-slate-500">
          ← 営業候補
        </Link>
        <h1 className="text-base font-bold">{String(prospect.company_name)}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
            Prospect
          </span>
          {prospect.do_not_contact ? (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
              DNC
            </span>
          ) : null}
          {prospect.formal_org_match_page_id ? (
            <Link
              href={`/organizations/${String(prospect.formal_org_match_page_id)}`}
              className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800 underline"
            >
              既存組織候補
            </Link>
          ) : null}
        </div>
      </div>

      <section className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-2">
        <Field label="Web" value={prospect.website_url as string | null} />
        <Field label="domain" value={prospect.normalized_domain as string | null} />
        <Field label="電話" value={prospect.main_phone as string | null} />
        <Field label="業種" value={prospect.industry as string | null} />
        <Field
          label="住所"
          value={[prospect.postal_code, prospect.prefecture, prospect.city, prospect.address]
            .filter(Boolean)
            .join(" ")}
        />
        <Field label="従業員規模" value={prospect.employee_range as string | null} />
        <Field label="メモ" value={prospect.notes as string | null} />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-800">Contacts</h2>
        {(contacts ?? []).length === 0 ? (
          <p className="text-slate-500">担当者候補なし</p>
        ) : (
          <ul className="divide-y rounded border border-slate-200 bg-white">
            {(contacts ?? []).map((c) => (
              <li key={String(c.id)} className="px-3 py-2">
                <div className="font-medium">
                  {String(c.name)}
                  {c.is_primary ? (
                    <span className="ml-1 text-slate-500">primary</span>
                  ) : null}
                </div>
                <div className="text-slate-600">
                  {[c.department, c.title, c.email, c.phone]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-800">所属営業リスト</h2>
        {(memberships ?? []).length === 0 ? (
          <p className="text-slate-500">所属なし</p>
        ) : (
          <ul className="divide-y rounded border border-slate-200 bg-white">
            {(memberships ?? []).map((m) => {
              const listId = String(m.prospect_list_id);
              const attrs = (m.source_attributes ?? {}) as Record<
                string,
                unknown
              >;
              return (
                <li key={String(m.id)} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/prospect-lists/${listId}`}
                      className="font-medium text-primary underline"
                    >
                      {listNames.get(listId) ?? "リスト"}
                    </Link>
                    <span>
                      {
                        PROSPECT_STAGE_LABELS[
                          m.stage as keyof typeof PROSPECT_STAGE_LABELS
                        ]
                      }
                    </span>
                    <span className="text-slate-600">
                      {m.assigned_user_id
                        ? assigneeNames.get(String(m.assigned_user_id)) ??
                          "担当あり"
                        : "未割当"}
                    </span>
                  </div>
                  {Object.keys(attrs).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-slate-500">
                        元データ
                      </summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[10px] text-slate-700">
                        {JSON.stringify(attrs, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canEdit ? (
        <ProspectDncForm
          prospectId={id}
          doNotContact={Boolean(prospect.do_not_contact)}
          reason={(prospect.do_not_contact_reason as string | null) ?? ""}
        />
      ) : null}

      <p className="text-slate-400">
        更新: {formatDateTime(String(prospect.updated_at))} ·
        架電履歴・正式組織昇格は Phase 13B
      </p>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-slate-800">{value || "—"}</div>
    </div>
  );
}
