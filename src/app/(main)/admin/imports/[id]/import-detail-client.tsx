"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCsvMapping,
  runCsvValidation,
  startCsvImport,
  cancelCsvImport,
  retryFailedCsvRows,
  buildErrorCsv,
} from "@/features/admin/imports/actions";

export function ImportDetailClient(props: {
  importJobId: string;
  status: string;
  headers: string[];
  fields: Array<{ key: string; labelJa: string; required: boolean }>;
  mapping: Record<string, string | null>;
  previewSummary: Record<string, number>;
  errorRows: Array<{ rowNumber: number; status: string; reason: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mapping, setMapping] = useState(props.mapping);
  const [message, setMessage] = useState<string | null>(null);

  const canMap =
    props.status === "mapping_required" ||
    props.status === "ready" ||
    props.status === "failed";
  const canValidate = canMap;
  const canStart =
    props.status === "ready" ||
    props.status === "failed" ||
    props.status === "partially_completed";
  const canCancel =
    props.status === "importing" ||
    props.status === "ready" ||
    props.status === "validating";

  return (
    <div className="space-y-4 text-xs">
      {Object.keys(props.previewSummary).length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-2 font-semibold">プレビュー集計</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(props.previewSummary).map(([k, v]) => (
              <span key={k} className="rounded bg-slate-50 px-2 py-1">
                {k}: {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {canMap && props.headers.length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-2 font-semibold">列マッピング</h2>
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">CSV列</th>
                <th className="py-1">システム項目</th>
              </tr>
            </thead>
            <tbody>
              {props.headers.map((h) => (
                <tr key={h} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{h}</td>
                  <td className="py-1">
                    <select
                      className="rounded border border-slate-300 px-2 py-1"
                      value={mapping[h] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          [h]: e.target.value || null,
                        }))
                      }
                    >
                      <option value="">(未使用)</option>
                      {props.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.labelJa}
                          {f.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className="rounded border border-slate-300 px-3 py-1.5"
              onClick={() =>
                start(async () => {
                  const res = await saveCsvMapping({
                    importJobId: props.importJobId,
                    mapping,
                  });
                  setMessage(
                    res.ok
                      ? "マッピングを保存しました"
                      : `mapping_error:${res.errors?.[0]?.code ?? "error"}`,
                  );
                  router.refresh();
                })
              }
            >
              マッピング保存
            </button>
            {canValidate && (
              <button
                type="button"
                disabled={pending}
                className="rounded bg-slate-800 px-3 py-1.5 text-white"
                onClick={() =>
                  start(async () => {
                    await saveCsvMapping({
                      importJobId: props.importJobId,
                      mapping,
                    });
                    await runCsvValidation(props.importJobId);
                    setMessage("検証ジョブを投入しました。少々お待ちください。");
                    router.refresh();
                  })
                }
              >
                検証実行
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canStart && (
          <button
            type="button"
            disabled={pending}
            className="rounded bg-slate-800 px-3 py-1.5 text-white"
            onClick={() =>
              start(async () => {
                const res = await startCsvImport(props.importJobId);
                setMessage(res.ok ? "取込を開始しました" : res.error);
                router.refresh();
              })
            }
          >
            取込開始
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-3 py-1.5"
            onClick={() =>
              start(async () => {
                await cancelCsvImport(props.importJobId);
                setMessage("キャンセルを要求しました");
                router.refresh();
              })
            }
          >
            キャンセル
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className="rounded border border-slate-300 px-3 py-1.5"
          onClick={() =>
            start(async () => {
              await retryFailedCsvRows(props.importJobId);
              setMessage("失敗行の再実行を投入しました");
              router.refresh();
            })
          }
        >
          失敗行リトライ
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded border border-slate-300 px-3 py-1.5"
          onClick={() =>
            start(async () => {
              const res = await buildErrorCsv(props.importJobId);
              if (!res.ok || !("csv" in res)) return;
              const blob = new Blob([res.csv], {
                type: "text/csv;charset=utf-8",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = res.filename;
              a.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          エラーCSV
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5"
          onClick={() => router.refresh()}
        >
          再読込
        </button>
      </div>

      {message && <p className="text-slate-600">{message}</p>}

      {props.errorRows.length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-2 font-semibold">エラー行（最大50件）</h2>
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">行</th>
                <th className="py-1">状態</th>
                <th className="py-1">理由</th>
              </tr>
            </thead>
            <tbody>
              {props.errorRows.map((r) => (
                <tr key={r.rowNumber} className="border-t border-slate-100">
                  <td className="py-1">{r.rowNumber}</td>
                  <td className="py-1">{r.status}</td>
                  <td className="py-1">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
