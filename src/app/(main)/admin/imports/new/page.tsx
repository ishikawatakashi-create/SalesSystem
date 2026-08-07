import { redirect } from "next/navigation";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { IMPORT_ENTITIES, ENTITY_DISPLAY_NAMES } from "@/lib/csv/entities";
import { NewImportForm } from "./new-import-form";

export default async function NewImportPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "csv.import")) redirect("/");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const entities = IMPORT_ENTITIES.map((e) => ({
    key: e,
    label: ENTITY_DISPLAY_NAMES[e],
  }));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-base font-bold">CSV取込を開始</h1>
      <p className="text-xs text-slate-500">
        UTF-8（BOM可）または Shift_JIS。最大20MB / 10,000行。原本はprivate
        storageに保存されます。
      </p>
      <NewImportForm entities={entities} />
    </div>
  );
}
