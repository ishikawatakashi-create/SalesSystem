import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isReplyOrForwardSubject,
  isStrikinglySourceNotification,
  isStrikinglySourceSubject,
} from "@/lib/inquiries/parser-strikingly";

const SOURCE_BODY = [
  "カスタムフォーム",
  "お問い合わせ種別",
  "その他",
  "名",
  "テスト太郎",
  "メールアドレス",
  "taro@in-iru.com",
  "お問い合わせ内容",
  "本文",
].join("\n");

describe("test inquiry 誤除外回帰", () => {
  it("元通知件名 + sentinel は source（社内ドメインでも）", () => {
    const subject = "テスト太郎 はあなたのサイトにコメントしました";
    expect(isStrikinglySourceSubject(subject)).toBe(true);
    expect(
      isStrikinglySourceNotification({
        subject,
        from: "sales@example.com",
        body: SOURCE_BODY,
      }),
    ).toBe(true);
  });

  it("Re/Fwd は除外", () => {
    expect(
      isReplyOrForwardSubject("Re: テスト太郎 はあなたのサイトにコメントしました"),
    ).toBe(true);
    expect(
      isStrikinglySourceSubject("Re: テスト太郎 はあなたのサイトにコメントしました"),
    ).toBe(false);
  });

  it("ingest は form email ドメインで demote しない", () => {
    const ingest = readFileSync(
      resolve(process.cwd(), "src/lib/inquiries/ingest.ts"),
      "utf8",
    );
    expect(ingest).toContain("isStrikinglySourceSubject");
    expect(ingest).toContain("source_body_incomplete");
    // 返信のみ ignored へ
    expect(ingest).toMatch(
      /if \(\s*existing &&\s*reply &&/,
    );
    expect(ingest).not.toMatch(/sender_email.*ignored_non_source/);
    expect(ingest).not.toMatch(/@in-iru\.com/);
  });
});
