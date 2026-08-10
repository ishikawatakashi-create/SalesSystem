"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const CALLBACK_PATH = "/auth/callback";

/**
 * Supabase標準Invite template({{ .ConfirmationURL }})のimplicit fragmentを
 * browser cookieへ保存し、server callbackのprovisioningへ引き渡す。
 * custom templateのtoken_hash / PKCE codeも同じcallbackへ中継する。
 */
export function InviteCompletion() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeInvite() {
      const query = new URLSearchParams(window.location.search);
      const tokenHash = query.get("token_hash");
      const code = query.get("code");

      if (tokenHash) {
        const callback = new URL(CALLBACK_PATH, window.location.origin);
        callback.searchParams.set("token_hash", tokenHash);
        callback.searchParams.set("type", "invite");
        window.location.replace(callback.toString());
        return;
      }
      if (code) {
        const callback = new URL(CALLBACK_PATH, window.location.origin);
        callback.searchParams.set("code", code);
        callback.searchParams.set("type", "invite");
        window.location.replace(callback.toString());
        return;
      }

      const fragment = new URLSearchParams(window.location.hash.slice(1));
      if (fragment.get("error") || fragment.get("error_code")) {
        if (!cancelled) {
          setError("招待リンクが無効か、有効期限が切れています。");
        }
        return;
      }

      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const supabase = createClient();

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          if (!cancelled) {
            setError("招待セッションを開始できませんでした。招待を再発行してください。");
          }
          return;
        }
      }

      // createBrowserClient自身がURLを処理した場合も含め、cookie sessionを確認する。
      const {
        data: { session },
        error: getSessionError,
      } = await supabase.auth.getSession();
      if (getSessionError || !session) {
        if (!cancelled) {
          setError("招待セッションを確認できませんでした。招待を再発行してください。");
        }
        return;
      }

      // fragment内のtokenを履歴から消してからserver callbackへ渡す。
      window.history.replaceState(null, "", "/auth/invite");
      window.location.replace(`${CALLBACK_PATH}?type=invite`);
    }

    void completeInvite();
    return () => {
      cancelled = true;
    };
  }, []);

  return error ? (
    <p role="alert" className="mt-4 text-sm text-red-600">
      {error}
    </p>
  ) : (
    <p className="mt-4 text-sm text-slate-600">
      招待を受諾し、初期設定画面へ移動しています。
    </p>
  );
}
