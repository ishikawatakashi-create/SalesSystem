import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabaseUrl } from "@/lib/env";

/**
 * Secret keyクライアント(RLSバイパス)。
 * システム操作(書込パイプライン・招待・プロビジョニング・ワーカー)専用。
 * このモジュールをクライアントコンポーネントからimportしてはならない
 * (server-onlyで保護)。
 *
 * 重要: Secret key経由の操作はRLSに守られない。呼び出し側は必ず
 * requireUser / requirePermission / Zod検証を通過していること
 * (docs/permissions.md)。
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("環境変数 SUPABASE_SECRET_KEY が設定されていません");
  }
  return createSupabaseClient<Database>(supabaseUrl(), secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
