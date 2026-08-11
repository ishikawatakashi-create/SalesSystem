import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/features/prospects/promote-dialog.tsx"),
  "utf8",
);

describe("prospect promotion target confirmation", () => {
  it("uses the same selected organization for confirmation and submission", () => {
    expect(source).toContain(
      "mode === \"link_existing\" ? selectedOrganizationId : null",
    );
    expect(source).toContain(
      "href={`/organizations/${encodeURIComponent(selectedOrganizationId)}`}",
    );
    expect(source).not.toContain(
      "href={`/organizations/${props.formalMatchPageId}`}",
    );
  });

  it("warns about an override and lets the user restore the automatic candidate", () => {
    expect(source).toContain("自動候補とは別の正式な組織を選択しています");
    expect(source).toContain("自動候補に戻す");
    expect(source).toContain(
      'setExistingPageId(props.formalMatchPageId ?? "")',
    );
  });

  it("keeps the raw identifier behind progressive disclosure", () => {
    expect(source).toContain("<details");
    expect(source).toContain("別の正式な組織を指定");
    expect(source).toContain("正式な組織の識別番号");
  });

  it("moves focus to the success state and exposes busy progress", () => {
    expect(source).toContain("if (started) successRef.current?.focus()");
    expect(source).toContain("ref={successRef}");
    expect(source).toContain("tabIndex={-1}");
    expect(source).toContain("aria-busy={pending}");
    expect(source).toContain('pending ? "登録処理中…"');
  });

  it("keeps a focusable status inside the modal while the request is pending", () => {
    expect(source).toContain("if (pending && !started) pendingRef.current?.focus()");
    expect(source).toContain("ref={pendingRef}");
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain("完了までお待ちください");
  });
});
