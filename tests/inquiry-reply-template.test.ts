import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildInquiryReplyDraftBody,
  normalizeReplySubject,
  quoteMessageText,
} from "@/lib/inquiries/reply-template";
import {
  buildSignedDraftEnvelope,
  verifyDraftEnvelope,
} from "@/lib/inquiries/draft-hmac";
import {
  isStrikinglySourceNotification,
  isStrikinglySourceSubject,
} from "@/lib/inquiries/parser-strikingly";

const SECRET = "draft-unit-test-secret";

describe("reply template", () => {
  it("会社名なしなら会社行を出さない", () => {
    const body = buildInquiryReplyDraftBody({
      companyName: "/",
      senderName: "架空太郎",
      actorDisplayName: "山田",
      messageText: "テストです",
    });
    expect(body.startsWith("架空太郎様")).toBe(true);
    expect(body).not.toMatch(/^\/$/m);
    expect(body).toContain("株式会社イルの山田です");
    expect(body).toContain("> テストです");
  });

  it("引用と Re 正規化", () => {
    expect(quoteMessageText("a\n\nb")).toBe("> a\n> \n> b");
    expect(normalizeReplySubject("Hello")).toBe("Re: Hello");
    expect(normalizeReplySubject("Re: Hello")).toBe("Re: Hello");
    expect(normalizeReplySubject("RE: Hello")).toBe("RE: Hello");
  });

  it("sender null でも敬称行を出す", () => {
    const body = buildInquiryReplyDraftBody({
      companyName: null,
      senderName: null,
      actorDisplayName: "佐藤",
      messageText: "x",
    });
    expect(body).toContain("ご担当者様");
  });

  it("ログイン表示名を本文に使う（メール推測しない）", () => {
    const body = buildInquiryReplyDraftBody({
      companyName: "株式会社テスト",
      senderName: "花子",
      actorDisplayName: "表示名のみ",
      messageText: "line1\n\nline2",
    });
    expect(body).toContain("株式会社テスト");
    expect(body).toContain("花子様");
    expect(body).toContain("株式会社イルの表示名のみです");
    expect(body).toContain("> line1\n> \n> line2");
  });
});

describe("draft HMAC envelope", () => {
  it("valid / invalid / stale / tamper", () => {
    const env = buildSignedDraftEnvelope({
      payload: { action: "list_aliases" },
      secret: SECRET,
    });
    expect(
      verifyDraftEnvelope({ ...env, secret: SECRET }).ok,
    ).toBe(true);

    expect(
      verifyDraftEnvelope({
        ...env,
        signature: "00".repeat(32),
        secret: SECRET,
      }).ok,
    ).toBe(false);

    expect(
      verifyDraftEnvelope({
        ...env,
        timestamp: String(Date.now() - 10 * 60 * 1000),
        secret: SECRET,
      }).ok,
    ).toBe(false);

    const other = buildSignedDraftEnvelope({
      payload: { action: "create_reply_draft" },
      secret: SECRET,
      nonce: env.nonce,
    });
    expect(
      verifyDraftEnvelope({
        timestamp: other.timestamp,
        nonce: other.nonce,
        payload_b64: env.payload_b64,
        signature: other.signature,
        secret: SECRET,
      }).ok,
    ).toBe(false);
  });
});

describe("source classification regression", () => {
  it("internal-domain form email でも source 維持（ドメイン非参照）", () => {
    const body = [
      "カスタムフォーム",
      "お問い合わせ種別",
      "その他",
      "名",
      "社内太郎",
      "メールアドレス",
      "taro@in-iru.com",
      "お問い合わせ内容",
      "テストです",
    ].join("\n");
    expect(
      isStrikinglySourceSubject("社内太郎 はあなたのサイトにコメントしました"),
    ).toBe(true);
    expect(
      isStrikinglySourceNotification({
        subject: "社内太郎 はあなたのサイトにコメントしました",
        from: "'社内太郎' via sales",
        body,
      }),
    ).toBe(true);
  });
});

describe("Apps Script send path static check", () => {
  it("Code.gs に sendEmail / message.reply 送信がない", () => {
    const src = readFileSync(
      resolve(process.cwd(), "integrations/apps-script/strikingly-inquiries/Code.gs"),
      "utf8",
    );
    expect(src).not.toMatch(/\.sendEmail\s*\(/);
    expect(src).not.toMatch(/\.reply\s*\(/);
    expect(src).toMatch(/createDraftReply\s*\(/);
  });
});
