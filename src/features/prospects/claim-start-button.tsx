"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { claimNextCallAction } from "@/features/prospects/call-actions";
import { normalizeCallQueueFilter } from "@/lib/prospects/call-filter";

export function ClaimStartButton(props: {
  listId: string | null;
  filter: string;
}) {
  const router = useRouter();
  const filter = normalizeCallQueueFilter(props.filter);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await claimNextCallAction({
              listId: props.listId,
              filter,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            if ("empty" in res && res.empty) {
              const query = new URLSearchParams({ empty: "1", filter });
              if (props.listId) query.set("list", props.listId);
              router.replace(`/call-queue?${query.toString()}`);
              return;
            }
            if ("membershipId" in res) {
              const query = new URLSearchParams({ filter });
              if (props.listId) query.set("list", props.listId);
              router.push(
                `/call-queue/${res.membershipId}?${query.toString()}`,
              );
            }
          });
        }}
      >
        {pending ? "取得中…" : "架電を開始"}
      </button>
      {error ? (
        <p className="rounded bg-red-50 px-2 py-1 text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
