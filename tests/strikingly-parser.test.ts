import { describe, expect, it } from "vitest";

import {
  looksLikeStrikinglyNotification,
  parseStrikinglyNotificationMail,
} from "@/lib/inquiries/parser-strikingly";
import { htmlToPlainText } from "@/lib/inquiries/html-text";

describe("parseStrikinglyNotificationMail", () => {
  it("Reply-To とラベル付き本文を解析する", () => {
    const parsed = parseStrikinglyNotificationMail({
      subject: "New Form Submission",
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
    expect(parsed.senderEmail).toBe("yamada@example.test");
    expect(parsed.senderName).toBe("山田太郎");
    expect(parsed.phone).toBe("090-1111-2222");
    expect(parsed.companyName).toBe("株式会社テスト");
    expect(parsed.messageText).toContain("資料請求");
    expect(parsed.parseStatus).toBe("ok");
    expect(parsed.sourceConfidence).toBe("high");
  });

  it("未知テンプレートでも破棄せず warning で本文を残す", () => {
    const parsed = parseStrikinglyNotificationMail({
      subject: "Hello",
      from: "someone@example.test",
      plainText: "ただの本文です",
    });
    expect(parsed.parseStatus).toBe("warning");
    expect(parsed.parseWarningCode).toBe("unknown_template");
    expect(parsed.messageText).toContain("ただの本文");
  });

  it("custom fields を form_fields に保持する", () => {
    const parsed = parseStrikinglyNotificationMail({
      subject: "Form submission from Strikingly",
      from: "noreply@strikingly.com",
      replyTo: "a@example.test",
      plainText: ["部署: 営業部", "お問い合わせ内容: 見積希望"].join("\n"),
    });
    expect(parsed.formFields["部署"]).toBe("営業部");
    expect(parsed.messageText).toContain("見積希望");
  });

  it("HTML を sanitization して plain 化する", () => {
    const text = htmlToPlainText(
      "<html><script>alert(1)</script><style>b{}</style><p>こんにちは<br>世界</p>",
    );
    expect(text).toContain("こんにちは");
    expect(text).not.toContain("script");
    expect(text).not.toContain("alert");
  });

  it("あなたのサイトにコメントしました を Strikingly と判定する", () => {
    expect(
      looksLikeStrikinglyNotification({
        subject: "お知らせ",
        from: "noreply@example.com",
        body: "田中さんがあなたのサイトにコメントしました",
      }),
    ).toBe(true);
  });

  it("実形式に近い日本語カスタムフォーム（架空fixture）を解析する", () => {
    const parsed = parseStrikinglyNotificationMail({
      subject: "架空花子 はあなたのサイトにコメントしました",
      from: "'架空花子' via sales",
      plainText: [
        "カスタムフォーム",
        "お問い合わせ種別: 資料請求",
        "名: 架空花子",
        "フリガナ: カクウハナコ",
        "会社名: 架空商事株式会社",
        "部署名: 企画部",
        "メールアドレス: hanako.kakou@example.test",
        "お問い合わせ内容:",
        "デモを希望します。",
      ].join("\n"),
    });
    expect(parsed.parseWarningCode).not.toBe("unknown_template");
    expect(parsed.senderName).toBe("架空花子");
    expect(parsed.senderEmail).toBe("hanako.kakou@example.test");
    expect(parsed.companyName).toBe("架空商事株式会社");
    expect(parsed.formName).toBe("資料請求");
    expect(parsed.messageText).toContain("デモを希望");
    expect(parsed.formFields["フリガナ"]).toBe("カクウハナコ");
    expect(parsed.formFields["部署名"]).toBe("企画部");
  });

  it("長い本文を truncate する", () => {
    const long = "あ".repeat(25_000);
    const parsed = parseStrikinglyNotificationMail({
      subject: "New contact form submission",
      from: "strikingly@example.com",
      plainText: long,
    });
    expect((parsed.messageText ?? "").length).toBeLessThan(25_000);
    expect(parsed.messageText).toContain("省略");
  });
});
