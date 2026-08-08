/**
 * Apps Script backfill の progress 状態（Code.gs と同趣旨の純関数）。
 * Script Properties に保存する JSON の形をテスト可能にする。
 *
 * - running: いま関数実行中のみ
 * - paused: chunk 終了後の待機（cursor 保持・再開可）
 * - stopped_by_user: 人間判断で停止（cursor/件数保持・completed にはしない）
 * - completed: 対象を取り切った
 * - idle: progress 未作成
 */

export type BackfillStatus =
  | "running"
  | "paused"
  | "stopped_by_user"
  | "completed"
  | "idle";

export type BackfillProgress = {
  status: BackfillStatus;
  thread_offset: number;
  processed: number;
  accepted: number;
  duplicate: number;
  skipped: number;
  failed: number;
  completed: boolean;
  stopped_reason?: string | null;
};

export function createBackfillProgress(): BackfillProgress {
  return {
    status: "paused",
    thread_offset: 0,
    processed: 0,
    accepted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    completed: false,
    stopped_reason: null,
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
    // chunk 間は「実行中」と誤認しないよう paused
    status: "paused",
    completed: false,
    stopped_reason: null,
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

/** failure retry: offset を進めず failed のみ加算（待機は paused） */
export function recordRetryableFailure(
  progress: BackfillProgress,
): BackfillProgress {
  return {
    ...progress,
    status: "paused",
    completed: false,
    failed: progress.failed + 1,
  };
}

/**
 * 人間判断で停止。cursor / 件数は保持。completed=true にはしない。
 * 旧 status=running の取り残しもここで安全に停止へ。
 */
export function stopBackfillByUser(
  progress: BackfillProgress | null,
): BackfillProgress | null {
  if (!progress) return null;
  if (progress.completed || progress.status === "completed") {
    return { ...progress, status: "completed", completed: true };
  }
  return {
    ...progress,
    status: "stopped_by_user",
    completed: false,
    stopped_reason: "human_partial_stop",
  };
}

/** 再開可能か（completed 以外） */
export function canResumeBackfill(progress: BackfillProgress | null): boolean {
  if (!progress) return true;
  if (progress.completed || progress.status === "completed") return false;
  return true;
}
