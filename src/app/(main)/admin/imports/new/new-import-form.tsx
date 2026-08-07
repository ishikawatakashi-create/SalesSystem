"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginCsvUpload, completeCsvUpload } from "@/features/admin/imports/actions";

export function NewImportForm(props: {
  entities: Array<{ key: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [entity, setEntity] = useState(props.entities[0]?.key ?? "customers");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const file = fd.get("file");
        if (!(file instanceof File)) {
          setError("ファイルを選択してください");
          return;
        }
        start(async () => {
          setError(null);
          const begun = await beginCsvUpload({
            entityType: entity,
            fileName: file.name,
            fileSize: file.size,
          });
          if (!begun.ok) {
            setError(begun.error);
            return;
          }
          const put = await fetch(begun.signedUploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "text/csv" },
            body: file,
          });
          if (!put.ok) {
            setError("upload_failed");
            return;
          }
          const done = await completeCsvUpload(begun.importJobId);
          if (!done.ok) {
            setError(done.error);
            return;
          }
          router.push(`/admin/imports/${begun.importJobId}`);
        });
      }}
    >
      <label className="block text-xs">
        <span className="mb-1 block text-slate-600">対象エンティティ</span>
        <select
          className="w-full rounded border border-slate-300 px-2 py-1.5"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          {props.entities.map((ent) => (
            <option key={ent.key} value={ent.key}>
              {ent.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="mb-1 block text-slate-600">CSVファイル</span>
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          className="block w-full text-xs"
          required
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-800 px-3 py-1.5 text-xs text-white disabled:opacity-50"
      >
        {pending ? "アップロード中…" : "アップロードしてマッピングへ"}
      </button>
    </form>
  );
}
