import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ensureProvisioned } from "@/lib/auth/provisioning";

/**
 * 認証コールバック。以下のすべての着地点を兼ねる:
 * - Google OAuth (PKCE): ?code=...
 * - メール招待 / パスワード再設定リンク: ?token_hash=...&type=invite|recovery
 * - パスワードログイン直後のプロビジョニング確認: パラメータなし(セッションあり)
 *
 * 認証成立後は必ずプロビジョニング(app_users作成・招待受諾)を確認し、
 * 失敗時はサインアウトしてログイン画面へ戻す(Hookの多重防御)。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();

  // 1) セッション確立
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  }

  // 2) ユーザー確認
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // 3) プロビジョニング(app_users作成・招待受諾)
  const result = await ensureProvisioned(user.id, user.email);
  if (!result.ok) {
    await supabase.auth.signOut();
    const errorCode = result.reason === "error" ? "auth" : result.reason;
    return NextResponse.redirect(`${origin}/login?error=${errorCode}`);
  }

  // 4) 招待・再設定リンク経由はパスワード設定画面へ
  if (type === "invite" || type === "recovery") {
    return NextResponse.redirect(`${origin}/auth/set-password`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}

/** オープンリダイレクト防止: 同一オリジンのパスのみ許可 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}
