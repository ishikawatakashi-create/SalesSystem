"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setProspectDncAction } from "@/features/prospects/actions";

export function ProspectDncForm({
  prospectId,
  doNotContact,
  reason,
}: {
  prospectId: string;
  doNotContact: boolean;
  reason: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localReason, setLocalReason] = useState(reason);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-3 text-xs">
      <h2 className="font-semibold text-slate-800">Do Not Contact</h2>
      {error ? <p className="text-red-600">{error}</p> : null}
      <input
        className="w-full rounded border border-slate-200 px-2 py-1"
        placeholder="理由"
        value={localReason}
        onChange={(e) => setLocalReason(e.target.value)}
        disabled={pending}
      />
      <div className="flex gap-2">
        {!doNotContact ? (
          <button
            type="button"
            disabled={pending}
            className="rounded bg-red-700 px-2 py-1 text-white disabled:opacity-50"
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await setProspectDncAction({
                  prospectId,
                  doNotContact: true,
                  reason: localReason,
                });
                if (!res.ok) setError(res.error);
                else router.refresh();
              });
            }}
          >
            DNC に設定
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await setProspectDncAction({
                  prospectId,
                  doNotContact: false,
                });
                if (!res.ok) setError(res.error);
                else router.refresh();
              });
            }}
          >
            DNC を解除
          </button>
        )}
      </div>
    </section>
  );
}
