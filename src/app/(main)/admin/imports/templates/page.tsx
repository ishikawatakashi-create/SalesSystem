import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { IMPORT_ENTITIES, ENTITY_DISPLAY_NAMES } from "@/lib/csv/entities";
import { getCsvTemplate } from "@/lib/csv/templates";
import { TemplateDownloadButtons } from "./template-download-buttons";

export default async function ImportTemplatesPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "csv.import")) redirect("/");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const templates = IMPORT_ENTITIES.map((e) => {
    const t = getCsvTemplate(e);
    return {
      entity: e,
      label: ENTITY_DISPLAY_NAMES[e],
      filename: t.filename,
      fieldsHelp: t.fieldsHelp,
      csv: t.csv,
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/imports" className="text-xs text-slate-500">
          ← CSV取込
        </Link>
        <h1 className="text-base font-bold">CSVテンプレート</h1>
        <p className="text-xs text-slate-500">
          架空サンプルのみ。実顧客データは含みません。移行キーは顧客→担当者→案件の順で解決します。
        </p>
      </div>
      <div className="space-y-4">
        {templates.map((t) => (
          <section
            key={t.entity}
            className="rounded border border-slate-200 bg-white p-4 text-xs"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{t.label}</h2>
              <TemplateDownloadButtons
                filename={t.filename}
                csv={t.csv}
              />
            </div>
            <ul className="space-y-1 text-slate-600">
              {t.fieldsHelp.map((f) => (
                <li key={f.key}>
                  <span className="font-medium text-slate-800">{f.label}</span>
                  {f.required ? " (必須)" : ""} — {f.key}
                  {f.notes ? ` / ${f.notes}` : ""} / 例: {f.example}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
