import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16のproxy(旧middleware)。
 * Supabaseセッションの更新と未認証リダイレクトを行う。
 */
export default async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 静的アセット等を除くすべてのリクエストパスに適用:
     * - _next/static, _next/image, favicon.ico
     * - 画像ファイル
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
