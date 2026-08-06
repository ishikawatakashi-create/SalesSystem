import type { JobHandler, JobKind } from "@/lib/jobs/types";

/**
 * kindごとのハンドラー登録。
 * Phase 1基盤段階ではnoopのみ。Notion接続後に各kindを実装する。
 */
const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: JobKind | string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export function getJobHandler(kind: string): JobHandler | undefined {
  return handlers.get(kind);
}

/** 基盤検証・滞留検知用のnoopハンドラー */
export const noopJobHandler: JobHandler = async () => ({ status: "succeeded" });

registerJobHandler("storage_cleanup", noopJobHandler);
registerJobHandler("dependency_reindex", noopJobHandler);
