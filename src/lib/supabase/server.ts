import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

/**
 * サーバー用クライアント(利用者JWT+RLS適用)。
 * Server Components / Server Actions / Route Handlersで使用する。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Componentからの呼び出しではcookieを書けない。
          // セッション更新はproxy(updateSession)が担うため無視してよい。
        }
      },
    },
  });
}
