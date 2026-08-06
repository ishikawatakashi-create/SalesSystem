import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ALLOW = new Set([
  join(ROOT, "src/lib/auth/admin-api.ts").replace(/\\/g, "/"),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "coverage") {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("Auth Admin API直接使用の禁止", () => {
  it("admin-api.ts以外で auth.admin.createUser / inviteUserByEmail を直接呼ばない", () => {
    const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "scripts")));
    const offenders: string[] = [];
    const pattern =
      /\.auth\.admin\.(createUser|inviteUserByEmail|generateLink)\s*\(/;

    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      if (ALLOW.has(normalized)) continue;
      // テストは検査対象外(リモート結合でlistUsers等を使う)
      if (normalized.includes("/tests/")) continue;
      const text = readFileSync(file, "utf8");
      if (pattern.test(text)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
