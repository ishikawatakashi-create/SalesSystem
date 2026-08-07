/**
 * Apps Script backfill の progress 状態（Code.gs と同趣旨の純関数）。
 * Script Properties に保存する JSON の形をテスト可能にする。
 */

export type BackfillProgress = {
  status: "running" | "completed" | "idle";
  thread_offset: number;
  processed: number;
  accepted: number;
  duplicate: number;
  skipped: number;
  failed: number;
  completed: boolean;
};

export function createBackfillProgress(): BackfillProgress {
  return {
    status: "running",
    thread_offset: 0,
    processed: 0,
    accepted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    completed: false,
  };
}

export function applyBackfillPageResult(
  progress: BackfillProgress,
  input: {
    threadsInPage: number;
    threadsFullyHandled: number;
    pageSize: number;
    stopEarly: boolean;
    delta: Partial<
      Pick<
        BackfillProgress,
        "processed" | "accepted" | "duplicate" | "skipped" | "failed"
      >
    >;
  },
): BackfillProgress {
  if (progress.completed || progress.status === "completed") {
    return { ...progress, status: "completed", completed: true };
  }

  const next: BackfillProgress = {
    ...progress,
    status: "running",
    completed: false,
    thread_offset: progress.thread_offset + input.threadsFullyHandled,
    processed: progress.processed + (input.delta.processed ?? 0),
    accepted: progress.accepted + (input.delta.accepted ?? 0),
    duplicate: progress.duplicate + (input.delta.duplicate ?? 0),
    skipped: progress.skipped + (input.delta.skipped ?? 0),
    failed: progress.failed + (input.delta.failed ?? 0),
  };

  const exhausted =
    !input.stopEarly && input.threadsInPage < input.pageSize;
  if (exhausted || (input.threadsInPage === 0 && !input.stopEarly)) {
    next.status = "completed";
    next.completed = true;
  }
  return next;
}

/** failure retry: offset を進めず failed のみ加算 */
export function recordRetryableFailure(
  progress: BackfillProgress,
): BackfillProgress {
  return {
    ...progress,
    status: "running",
    completed: false,
    failed: progress.failed + 1,
  };
}
