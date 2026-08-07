"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requirePermission, AuthError } from "@/lib/auth/require";
import {
  markVerified,
  revealVerificationToken,
} from "@/lib/webhooks/verification-store";

/** UI共有用(clientからも参照可。トークンは含まない) */
export type WebhookSetupStatus = "awaiting" | "received" | "verified";

export type RevealTokenResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export type MarkVerifiedResult =
  | { ok: true; status: WebhookSetupStatus }
  | { ok: false; message: string };

/**
 * verification_token を明示操作でのみ取得する。
 * トークンはログ・監査ログに出さない。呼び出し側も永続化しないこと。
 */
export async function revealWebhookVerificationTokenAction(): Promise<RevealTokenResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "sync.manage");
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }

  try {
    const token = await revealVerificationToken();
    if (!token) {
      return {
        ok: false,
        message:
          "確認用トークンはまだ受信されていません。NotionでWebhook購読を開始し、この画面の状態が「受信済み」になるまでお待ちください。",
      };
    }
    return { ok: true, token };
  } catch {
    return {
      ok: false,
      message: "確認用トークンを取得できませんでした。時間をおいて再度お試しください。",
    };
  }
}

/** Notion側のVerify完了後に、セットアップ状態を verified へ進める。 */
export async function markWebhookVerifiedAction(): Promise<MarkVerifiedResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "sync.manage");
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }

  try {
    const result = await markVerified();
    revalidatePath("/admin/sync");
    return { ok: true, status: result.status };
  } catch {
    return {
      ok: false,
      message: "検証完了の反映に失敗しました。時間をおいて再度お試しください。",
    };
  }
}
