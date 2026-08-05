import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * サインアウト。
 * - POST: ヘッダーのログアウトボタン(フォーム送信)
 * - GET: サーバー側ガードからの強制サインアウト(?error=... 付きでログイン画面へ)
 */
export async function POST(request: NextRequest) {
  await signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}

export async function GET(request: NextRequest) {
  await signOut();
  const url = new URL("/login", request.url);
  const error = new URL(request.url).searchParams.get("error");
  if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url);
}

async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
