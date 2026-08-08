"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  commitProspectImportAction,
  createProspectImportUploadAction,
  prepareProspectImportAction,
} from "@/features/prospects/actions";
import {
  PROSPECT_CSV_FIELD_LABELS,
  PROSPECT_CSV_FIELDS,
  type ProspectColumnMapping,
  type ProspectCsvField,
} from "@/lib/prospects/import-mapping";

type PreviewRow = {
  rowNumber: number;
  staged: { companyName: string };
  ok: boolean;
  warnings: string[];
  errors: string[];
};

export function ProspectImportWizard({ listId }: { listId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<"upload" | "map" | "done">("upload");
  const [error, setError] = useState<string | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ProspectColumnMapping>({});
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [encoding, setEncoding] = useState("");

  const headerOptions = useMemo(
    () => ["", ...headers],
    [headers],
  );

  return (
    <div className="space-y-4 text-xs">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">
          {error}
        </p>
      ) : null}

      {step === "upload" && (
        <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
          <p className="font-medium text-slate-800">1. CSVファイルを選択</p>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError(null);
              start(async () => {
                const created = await createProspectImportUploadAction({
                  listId,
                  fileName: file.name,
                  fileSize: file.size,
                });
                if (!created.ok) {
                  setError(created.error);
                  return;
                }
                const put = await fetch(created.signedUploadUrl, {
                  method: "PUT",
                  headers: { "Content-Type": "text/csv" },
                  body: file,
                });
                if (!put.ok) {
                  setError("アップロードに失敗しました");
                  return;
                }
                const prepared = await prepareProspectImportAction({
                  importJobId: created.importJobId,
                });
                if (!prepared.ok) {
                  setError(prepared.error);
                  return;
                }
                setImportJobId(created.importJobId);
                setHeaders(prepared.headers);
                setMapping(prepared.mapping);
                setUnmapped(prepared.unmapped);
                setPreview(prepared.preview as PreviewRow[]);
                setTotalRows(prepared.totalRows);
                setEncoding(prepared.encoding);
                setStep("map");
              });
            }}
          />
          <p className="text-slate-500">
            UTF-8 / Shift_JIS。Notion には書き込みません。
          </p>
        </div>
      )}

      {step === "map" && importJobId && (
        <div className="space-y-3">
          <div className="rounded border border-slate-200 bg-white p-3">
            <p className="mb-2 font-medium text-slate-800">
              2. 列マッピング（{totalRows}行 / {encoding}）
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROSPECT_CSV_FIELDS.map((field: ProspectCsvField) => (
                <label key={field} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-slate-600">
                    {PROSPECT_CSV_FIELD_LABELS[field]}
                    {field === "companyName" ? " *" : ""}
                  </span>
                  <select
                    className="flex-1 rounded border border-slate-200 px-1 py-0.5"
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field]: e.target.value || null,
                      }))
                    }
                  >
                    {headerOptions.map((h) => (
                      <option key={h || "__empty"} value={h}>
                        {h || "（未設定）"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {unmapped.length > 0 ? (
              <p className="mt-2 text-slate-500">
                未マッピング列は source_attributes に保存:{" "}
                {unmapped.join(", ")}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-3 rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const prepared = await prepareProspectImportAction({
                    importJobId,
                    mapping,
                  });
                  if (!prepared.ok) {
                    setError(prepared.error);
                    return;
                  }
                  setPreview(prepared.preview as PreviewRow[]);
                  setUnmapped(prepared.unmapped);
                });
              }}
            >
              プレビュー更新
            </button>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1">行</th>
                  <th className="px-2 py-1">会社名</th>
                  <th className="px-2 py-1">判定</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.rowNumber} className="border-t border-slate-100">
                    <td className="px-2 py-1">{p.rowNumber}</td>
                    <td className="px-2 py-1">
                      {p.staged.companyName || "（空）"}
                    </td>
                    <td className="px-2 py-1">
                      {p.ok ? (
                        <span className="text-green-700">OK</span>
                      ) : (
                        <span className="text-red-600">
                          {p.errors.join("; ")}
                        </span>
                      )}
                      {p.warnings.length > 0 ? (
                        <span className="ml-1 text-amber-600">
                          {p.warnings.join("; ")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700 disabled:opacity-50"
            disabled={pending || !mapping.companyName}
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await commitProspectImportAction({
                  importJobId,
                  mapping,
                  listId,
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setTotalRows(res.totalRows);
                setStep("done");
                router.refresh();
              });
            }}
          >
            インポート実行
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <p className="font-medium text-slate-800">取込を開始しました</p>
          <p className="mt-1 text-slate-600">
            {totalRows}行をキュー投入済み。バックグラウンドで処理されます（Notion
            非書込）。
          </p>
          <a
            href={`/prospect-lists/${listId}`}
            className="mt-2 inline-block text-primary underline"
          >
            リストへ戻る
          </a>
        </div>
      )}
    </div>
  );
}
