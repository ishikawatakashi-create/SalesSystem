"use client";

export function TemplateDownloadButtons(props: {
  filename: string;
  csv: string;
}) {
  return (
    <button
      type="button"
      className="rounded border border-slate-300 px-2 py-1"
      onClick={() => {
        const blob = new Blob([props.csv], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = props.filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      ダウンロード
    </button>
  );
}
