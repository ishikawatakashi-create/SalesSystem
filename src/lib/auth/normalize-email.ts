/**
 * メールアドレスの正規化。
 * user_invitations.normalized_email、およびGoogle OAuth時の照合に使用する。
 * DB側(Before User Created Hook)の lower(trim(...)) と同一の結果になること。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
