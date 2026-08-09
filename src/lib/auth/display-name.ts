/** display_name の検証（SSoT は app_users.display_name） */
export const DISPLAY_NAME_MAX_LENGTH = 100;

export type DisplayNameValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function validateDisplayName(
  raw: string | null | undefined,
): DisplayNameValidation {
  const value = (raw ?? "").trim();
  if (!value) {
    return { ok: false, message: "表示名を入力してください" };
  }
  if (value.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内にしてください`,
    };
  }
  // 制御文字を拒否（表示用文字列として安全側）
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    return { ok: false, message: "表示名に使用できない文字が含まれています" };
  }
  return { ok: true, value };
}

/**
 * fixture / 開発用アカウント判定。
 * display_name 文字列は見ない（本物っぽい名前への誤判定を避ける）。
 */
export function isFixtureUserAccount(input: {
  email: string | null | undefined;
}): boolean {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return false;
  const [local, domain] = email.split("@");
  if (!domain || !local) return false;

  if (domain === "example.invalid" || domain === "example.com") return true;
  if (domain.endsWith(".example.invalid")) return true;

  // 既知の自動テスト接頭辞
  if (
    local.startsWith("test_phase") ||
    local.startsWith("auth-spike") ||
    local.startsWith("test-phase") ||
    local.startsWith("test_ui") ||
    local.startsWith("spike")
  ) {
    return true;
  }
  return false;
}
