"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { clearGmailRefreshToken } from "@/lib/integrations/gmail/tokens";
import {
  getGmailSettings,
  patchGmailSettings,
} from "@/lib/integrations/gmail/settings";
import { listGmailLabels } from "@/lib/integrations/gmail/client";
import { renewGmailWatch } from "@/lib/integrations/gmail/watch";
import { enqueueJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message?: string } | { ok: false; message: string };

function fail(e: unknown): Result {
  if (e instanceof AuthError) return { ok: false, message: "権限がありません" };
  if (e instanceof Error && e.message === "gmail_reconnect_required") {
    return { ok: false, message: "Gmail の再接続が必要です" };
  }
  return { ok: false, message: "操作に失敗しました" };
}

export async function disconnectGmailAction(): Promise<Result> {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    await clearGmailRefreshToken();
    revalidatePath("/admin/integrations/gmail");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setGmailLabelAction(input: {
  labelId: string;
  labelName: string;
}): Promise<Result> {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    if (!input.labelId.trim()) {
      return { ok: false, message: "label を選択してください" };
    }
    await patchGmailSettings({
      label_id: input.labelId,
      label_name: input.labelName,
      // label 変更後は明示的に ingestion 開始するまで無効
      ingestion_enabled: false,
    });
    revalidatePath("/admin/integrations/gmail");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setGmailIngestionEnabledAction(input: {
  enabled: boolean;
}): Promise<Result> {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    const settings = await getGmailSettings();
    if (input.enabled) {
      if (settings.status !== "connected") {
        return { ok: false, message: "先に Gmail を接続してください" };
      }
      if (!settings.label_id) {
        return { ok: false, message: "先に label を選択してください" };
      }
    }
    await patchGmailSettings({ ingestion_enabled: input.enabled });
    if (input.enabled) {
      const watch = await renewGmailWatch();
      if (!watch.ok && watch.reason !== "ingestion_disabled") {
        return {
          ok: false,
          message: "取り込みは有効化しましたが watch 開始に失敗しました。再試行してください",
        };
      }
    }
    revalidatePath("/admin/integrations/gmail");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renewGmailWatchAction(): Promise<Result> {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    const result = await renewGmailWatch();
    revalidatePath("/admin/integrations/gmail");
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === "label_not_selected"
            ? "label を選択してください"
            : result.reason === "ingestion_disabled"
              ? "取り込みが無効です"
              : "watch の更新に失敗しました",
      };
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function enqueueGmailReconciliationAction(): Promise<Result> {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    await enqueueJob({
      kind: "gmail_reconciliation",
      payload: { reason: "manual" },
      idempotencyKey: `gmail_reconciliation:manual:${new Date().toISOString().slice(0, 13)}`,
      priority: 50,
      createdBy: user.id,
    });
    revalidatePath("/admin/integrations/gmail");
    return { ok: true, message: "再同期ジョブを投入しました" };
  } catch (e) {
    return fail(e);
  }
}

export async function loadGmailLabelsAction(): Promise<
  | { ok: true; labels: Array<{ id: string; name: string }> }
  | { ok: false; message: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    const labels = await listGmailLabels();
    return { ok: true, labels };
  } catch (e) {
    if (e instanceof Error && e.message === "gmail_reconnect_required") {
      return { ok: false, message: "Gmail の再接続が必要です" };
    }
    return { ok: false, message: "label 一覧の取得に失敗しました" };
  }
}

export async function countGmailJobFailures(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("kind", ["gmail_history_sync", "gmail_watch_renew", "gmail_reconciliation"])
    .eq("status", "failed");
  return count ?? 0;
}
