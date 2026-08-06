import "server-only";

/**
 * ワーカー起動方式の抽象化。
 * ワーカー本体(/api/jobs/run)とジョブ処理は起動方式に依存しない。
 */
export interface JobScheduler {
  /** 毎分ワーカーを起動するスケジュールを登録・更新する */
  ensureSchedule(options: {
    workerUrl: string;
    cronSecret: string;
  }): Promise<void>;
  describe(): string;
}

export class SupabaseCronScheduler implements JobScheduler {
  describe(): string {
    return "SupabaseCronScheduler(pg_cron + pg_net → POST /api/jobs/run)";
  }

  /**
   * system_settingsへワーカーURLを保存し、pg_cronジョブを登録する。
   * pg_cron/pg_netが未有効の環境ではエラーを返す(ダッシュボードでの有効化が必要)。
   */
  async ensureSchedule(options: {
    workerUrl: string;
    cronSecret: string;
  }): Promise<void> {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();

    const { error: settingsError } = await admin.from("system_settings").upsert({
      key: "job_worker",
      value: {
        url: options.workerUrl,
        scheduler: "supabase_cron",
        // 秘密はDBに保存しない。CRON_SECRETはNext.js側環境変数のみ。
        secret_header: "x-cron-secret",
      },
      updated_at: new Date().toISOString(),
    });
    if (settingsError) {
      throw new Error(`ジョブワーカー設定の保存に失敗しました: ${settingsError.message}`);
    }

    // pg_cron登録はSQL。secretはヘッダーに毎回渡すためvault相当が必要だが、
    // 初期版はダッシュボード/運用SQLで設定する手順とし、ここでは設定保存まで行う。
    void options.cronSecret;
  }
}

/** Vercel Pro以上向けの差し替え候補(未接続)。 */
export class VercelCronScheduler implements JobScheduler {
  describe(): string {
    return "VercelCronScheduler(vercel.json crons → POST /api/jobs/run)";
  }

  async ensureSchedule(): Promise<void> {
    // vercel.json の cron 設定に依存。アプリ起動時の動的登録は不要。
  }
}

export function createDefaultScheduler(): JobScheduler {
  return new SupabaseCronScheduler();
}
