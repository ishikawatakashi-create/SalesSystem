import "server-only";

/**
 * Supabase Dashboardの Email OTP Expiration と同じ秒数を返す。
 *
 * 招待リンクの実期限はSupabase Auth側が決めるため、推測による既定値は持たない。
 * 管理者招待を有効にするには、実プロジェクトの設定値を
 * SUPABASE_EMAIL_OTP_EXPIRY_SECONDSへ明示する。
 */
export function emailOtpExpirySeconds(): number {
  const raw = process.env.SUPABASE_EMAIL_OTP_EXPIRY_SECONDS;
  const seconds = raw ? Number(raw) : Number.NaN;

  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds * 1_000 > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      "SUPABASE_EMAIL_OTP_EXPIRY_SECONDSをSupabase AuthのEmail OTP Expirationと同じ正の整数秒で設定してください",
    );
  }

  return seconds;
}

export function invitationExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + emailOtpExpirySeconds() * 1_000).toISOString();
}
