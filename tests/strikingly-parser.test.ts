import { describe, expect, it } from "vitest";

import {
  isReplyOrForwardSubject,
  isStrikinglySourceNotification,
  isStrikinglySourceSubject,
  parseStrikinglyNotificationMail,
  selectParseBody,
} from "@/lib/inquiries/parser-strikingly";
import { htmlToPlainText } from "@/lib/inquiries/html-text";

const SOURCE_SUBJECT = "架空花子 はあなたのサイトにコメントしました";

function sourceBodyLines(overrides?: { message?: string; company?: string }) {
  return [
    "カスタムフォーム",
    "お問い合わせ種別",
    "資料請求",
    "名",
    "架空花子",
    "フリガナ",
    "カクウハナコ",
    "会社名",
    overrides?.company ?? "/",
    "部署名",
    "企画部",
    "メールアドレス",
    "hanako.kakou@example.test",
    "お問い合わせ内容",
    overrides?.message ?? "テストです",
    "",
    "このメールを返信して",
    "すべての返事を読む",
  ].join("\n");
}

describe("isStrikinglySourceNotification / reply exclusion", () => {
  it("Re:/RE:/Fwd: は除外", () => {
    expect(isReplyOrForwardSubject("Re: 架空花子 はあなたのサイトにコメントしました")).toBe(
      true,
    );
    expect(isReplyOrForwardSubject("RE: hello")).toBe(true);
    expect(isReplyOrForwardSubject("Fwd: x")).toBe(true);
    expect(isStrikinglySourceNotification({
      subject: "Re: 架空花子 はあなたのサイトにコメントしました",
      body: sourceBodyLines(),
    })).toBe(false);
  });

  it("件名+sentinel が揃えば source", () => {
    expect(
      isStrikinglySourceNotification({
        subject: SOURCE_SUBJECT,
        from: "'架空花子' via sales",
        body: sourceBodyLines(),
      }),
    ).toBe(true);
  });

  it("From だけでは source にしない", () => {
    expect(
      isStrikinglySourceNotification({
        subject: "Hello",
        from: "'架空花子' via sales",
        body: "no sentinels",
      }),
    ).toBe(false);
  });

  it("source subject 判定はメールドメイン非依存", () => {
    expect(
      isStrikinglySourceSubject("テスト はあなたのサイトにコメントしました"),
    ).toBe(true);
    expect(isStrikinglySourceSubject("Re: テスト はあなたのサイトにコメントしました")).toBe(
      false,
    );
  });
});

describe("parseStrikinglyNotificationMail (v2)", () => {
  it("ラベル改行形式から名/会社/メール/本文を抽出する", () => {
    const parsed = parseStrikinglyNotificationMail({
      subject: SOURCE_SUBJECT,
      from: "'架空花子' via sales <sales@example.test>",
      plainText: sourceBodyLines({ company: "/" }),
    });
    expect(parsed.senderName).toBe("架空花子");
    expect(parsed.senderName).not.toMatch(/via sales/i);
    expect(parsed.companyName).toBeNull();
    expect(parsed.senderEmail).toBe("hanako.kakou@example.test");
    expect(parsed.inquiryType).toBe("資料請求");
    expect(parsed.formName).toBe("資料請求");
    expect(parsed.department).toBe("企画部");
    expect(parsed.senderKana).toBe("カクウハナコ");
    expect(parsed.messageText).toBe("テストです");
    expect(parsed.messageText).not.toContain("このメールを返信して");
    expect(parsed.messageText).not.toContain("あなたのサイトにコメント");
    expect(parsed.formFields["フリガナ"]).toBe("カクウハナコ");
    expect(parsed.formFields["部署名"]).toBe("企画部");
    expect(parsed.parseStatus).toBe("ok");
  });

  it("plain が欠落しても HTML から抽出する", () => {
    const html = `
      <html><body>
      <script>alert(1)</script>
      <p>カスタムフォーム</p>
      <p>お問い合わせ種別<br>採用について</p>
      <p>名<br>架空太郎</p>
      <p>フリガナ<br>カクウタロウ</p>
      <p>会社名<br>架空商事</p>
      <p>部署名<br>/</p>
      <p>メールアドレス<br>taro.kakou@example.test</p>
      <p>お問い合わせ内容<br>テストです</p>
      <p>このメールを返信して</p>
      </body></html>
    `;
    const parsed = parseStrikinglyNotificationMail({
      subject: "架空太郎 はあなたのサイトにコメントしました",
      from: "'架空太郎' via sales",
      plainText: "架空太郎 commented on your site https://example.test/x",
      htmlText: html,
    });
    expect(parsed.senderName).toBe("架空太郎");
    expect(parsed.companyName).toBe("架空商事");
    expect(parsed.senderEmail).toBe("taro.kakou@example.test");
    expect(parsed.messageText).toBe("テストです");
    expect(selectParseBody(
      "架空太郎 commented on your site https://example.test/x",
      htmlToPlainText(html),
    )).toContain("お問い合わせ内容");
  });

  it("コロン付きラベル形式も解析する", () => {
    const parsed = parseStrikinglyNotificationMail({
      subject: "New Form Submission from Strikingly",
      from: "Strikingly <noreply@strikingly.com>",
      replyTo: "山田太郎 <yamada@example.test>",
      plainText: [
        "名前: 山田太郎",
        "メール: yamada@example.test",
        "電話: 090-1111-2222",
        "会社: 株式会社テスト",
        "お問い合わせ内容:",
        "資料請求したいです。",
      ].join("\n"),
    });
    // 新ゲート件名ではないため warning になり得るが field 抽出は行う
    expect(parsed.senderEmail).toBe("yamada@example.test");
    expect(parsed.senderName).toBe("山田太郎");
    expect(parsed.messageText).toContain("資料請求");
  });

  it("HTML を sanitization して plain 化する", () => {
    const text = htmlToPlainText(
      "<html><script>alert(1)</script><style>b{}</style><p>こんにちは<br>世界</p>",
    );
    expect(text).toContain("こんにちは");
    expect(text).not.toContain("script");
    expect(text).not.toContain("alert");
  });
});
