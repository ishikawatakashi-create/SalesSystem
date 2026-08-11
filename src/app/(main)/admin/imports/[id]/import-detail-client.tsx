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
import {
  adminStatusBadgeClass,
  csvActionErrorMessage,
  csvImportFailureReason,
  csvMappingErrorMessage,
  importPreviewSummaryLabel,
  importRowStatusPresentation,
} from "@/lib/admin-presentation";

type Feedback = {
  kind: "success" | "error";
  text: string;
};

function mappingFailureMessage(
  result: Awaited<ReturnType<typeof saveCsvMapping>>,
  fieldLabels: Record<string, string>,
): string {
  if ("errors" in result) {
    const firstError = result.errors?.[0];
    return csvMappingErrorMessage(
      firstError?.code,
      firstError?.fieldKey ? fieldLabels[firstError.fieldKey] : undefined,
    );
  }
  return csvActionErrorMessage("error" in result ? result.error : undefined);
}

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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const fieldLabels = Object.fromEntries(
    props.fields.map((field) => [field.key, field.labelJa]),
  );

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
          <h2 className="mb-2 font-semibold">取込前の集計</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(props.previewSummary).map(([k, v]) => (
              <span key={k} className="rounded bg-slate-50 px-2 py-1">
                {importPreviewSummaryLabel(k)}: {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {canMap && props.headers.length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-2 font-semibold">CSV列の対応付け</h2>
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">CSV列</th>
                <th className="py-1">取込先の項目</th>
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
                  setFeedback(null);
                  try {
                    const res = await saveCsvMapping({
                      importJobId: props.importJobId,
                      mapping,
                    });
                    if (!res.ok) {
                      setFeedback({
                        kind: "error",
                        text: mappingFailureMessage(res, fieldLabels),
                      });
                      return;
                    }
                    setFeedback({
                      kind: "success",
                      text: "列の対応付けを保存しました",
                    });
                    router.refresh();
                  } catch {
                    setFeedback({
                      kind: "error",
                      text: csvActionErrorMessage(undefined),
                    });
                  }
                })
              }
            >
              列の対応付けを保存
            </button>
            {canValidate && (
              <button
                type="button"
                disabled={pending}
                className="rounded bg-slate-800 px-3 py-1.5 text-white"
                onClick={() =>
                  start(async () => {
                    setFeedback(null);
                    try {
                      const mappingResult = await saveCsvMapping({
                        importJobId: props.importJobId,
                        mapping,
                      });
                      if (!mappingResult.ok) {
                        setFeedback({
                          kind: "error",
                          text: mappingFailureMessage(
                            mappingResult,
                            fieldLabels,
                          ),
                        });
                        return;
                      }
                      const validationResult = await runCsvValidation(
                        props.importJobId,
                      );
                      if (!validationResult.ok) {
                        setFeedback({
                          kind: "error",
                          text: csvActionErrorMessage(validationResult.error),
                        });
                        return;
                      }
                      setFeedback({
                        kind: "success",
                        text: "内容の確認を開始しました。完了までお待ちください。",
                      });
                      router.refresh();
                    } catch {
                      setFeedback({
                        kind: "error",
                        text: csvActionErrorMessage(undefined),
                      });
                    }
                  })
                }
              >
                内容を確認
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
                setFeedback(null);
                try {
                  const res = await startCsvImport(props.importJobId);
                  if (!res.ok) {
                    setFeedback({
                      kind: "error",
                      text: csvActionErrorMessage(res.error),
                    });
                    return;
                  }
                  setFeedback({
                    kind: "success",
                    text: "CSV取込を開始しました",
                  });
                  router.refresh();
                } catch {
                  setFeedback({
                    kind: "error",
                    text: csvActionErrorMessage(undefined),
                  });
                }
              })
            }
          >
            CSV取込を開始
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-3 py-1.5"
            onClick={() =>
              start(async () => {
                setFeedback(null);
                try {
                  const res = await cancelCsvImport(props.importJobId);
                  if (!res.ok) {
                    setFeedback({
                      kind: "error",
                      text: csvActionErrorMessage(res.error),
                    });
                    return;
                  }
                  setFeedback({
                    kind: "success",
                    text: "キャンセルを要求しました",
                  });
                  router.refresh();
                } catch {
                  setFeedback({
                    kind: "error",
                    text: csvActionErrorMessage(undefined),
                  });
                }
              })
            }
          >
            取込をキャンセル
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className="rounded border border-slate-300 px-3 py-1.5"
          onClick={() =>
            start(async () => {
              setFeedback(null);
              try {
                const res = await retryFailedCsvRows(props.importJobId);
                if (!res.ok) {
                  setFeedback({
                    kind: "error",
                    text: csvActionErrorMessage(res.error),
                  });
                  return;
                }
                setFeedback({
                  kind: "success",
                  text: "失敗した行の再取込を開始しました",
                });
                router.refresh();
              } catch {
                setFeedback({
                  kind: "error",
                  text: csvActionErrorMessage(undefined),
                });
              }
            })
          }
        >
          失敗行を再取込
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded border border-slate-300 px-3 py-1.5"
          onClick={() =>
            start(async () => {
              setFeedback(null);
              try {
                const res = await buildErrorCsv(props.importJobId);
                if (!res.ok) {
                  setFeedback({
                    kind: "error",
                    text: csvActionErrorMessage(res.error),
                  });
                  return;
                }
                const blob = new Blob([res.csv], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = res.filename;
                a.click();
                URL.revokeObjectURL(url);
                setFeedback({
                  kind: "success",
                  text: "エラー内容のCSVを保存しました",
                });
              } catch {
                setFeedback({
                  kind: "error",
                  text: csvActionErrorMessage(undefined),
                });
              }
            })
          }
        >
          エラー内容をCSVで保存
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5"
          onClick={() => router.refresh()}
        >
          表示を更新
        </button>
      </div>

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={
            feedback.kind === "error"
              ? "rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700"
              : "rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800"
          }
        >
          {feedback.text}
        </p>
      )}

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
              {props.errorRows.map((r) => {
                const status = importRowStatusPresentation(r.status);
                return (
                  <tr key={r.rowNumber} className="border-t border-slate-100">
                    <td className="py-1">{r.rowNumber}</td>
                    <td className="py-1">
                      <span className={adminStatusBadgeClass(status.tone)}>
                        {status.label}
                      </span>
                    </td>
                    <td className="py-1">
                      <p>{csvImportFailureReason(r.reason, fieldLabels)}</p>
                      <details className="mt-1 text-[11px] text-slate-500">
                        <summary className="cursor-pointer">技術情報</summary>
                        <dl className="mt-1 grid gap-1">
                          <div>
                            <dt className="inline">状態コード: </dt>
                            <dd className="inline font-mono">{r.status}</dd>
                          </div>
                          <div>
                            <dt className="inline">理由コード: </dt>
                            <dd className="inline break-all font-mono">
                              {r.reason || "（記録なし）"}
                            </dd>
                          </div>
                        </dl>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
