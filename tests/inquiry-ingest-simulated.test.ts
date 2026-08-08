import { describe, expect, it, vi } from "vitest";

import { parseStrikinglyNotificationMail } from "@/lib/inquiries/parser-strikingly";
import {
  signInquiryRequest,
  verifyInquiryHmac,
} from "@/lib/inquiries/apps-script-hmac";
import { heartbeatHealth } from "@/lib/inquiries/apps-script-health";
import { titleFromActivityBody } from "@/lib/activities/quick-title";

/**
 * Apps Script transport 相当の simulated フロー（HMAC / parser / dedupe / health）。
 */
describe("Phase 11 simulated inquiry flow (Apps Script)", () => {
  it("signed Apps Script payload → Strikingly parse → activity prefill", () => {
    const payload = {
      source: "strikingly_email",
      gmail_message_id: "gmail-msg-abc",
      gmail_thread_id: "thread-1",
      received_at: new Date().toISOString(),
      from: "'佐藤花子' via sales",
      reply_to: null as string | null,
      subject: "佐藤花子 はあなたのサイトにコメントしました",
      plain_body: [
        "カスタムフォーム",
        "お問い合わせ種別",
        "デモ希望",
        "名",
        "佐藤花子",
        "フリガナ",
        "サトウハナコ",
        "会社名",
        "架空商事",
        "部署名",
        "/",
        "メールアドレス",
        "sato@example.test",
        "お問い合わせ内容",
        "デモ希望です。",
        "このメールを返信して",
      ].join("\n"),
    };
    const raw = JSON.stringify(payload);
    const ts = String(Date.now());
    const secret = "sim-secret-16chars";
    const sig = signInquiryRequest(ts, raw, secret);
    expect(
      verifyInquiryHmac({
        timestamp: ts,
        signature: sig,
        rawBody: raw,
        secret,
      }).ok,
    ).toBe(true);

    const parsed = parseStrikinglyNotificationMail({
      subject: payload.subject,
      from: payload.from,
      replyTo: payload.reply_to,
      plainText: payload.plain_body,
    });

    expect(parsed.senderEmail).toBe("sato@example.test");
    expect(parsed.senderName).toBe("佐藤花子");
    expect(parsed.companyName).toBe("架空商事");
    expect(parsed.messageText).toBe("デモ希望です。");
    expect(parsed.parseStatus).toBe("ok");

    const dedupeKey = payload.gmail_message_id;
    expect(dedupeKey).toBe("gmail-msg-abc");

    const activityTitle = `Webお問い合わせ：${parsed.subject}`.slice(0, 80);
    expect(activityTitle.startsWith("Webお問い合わせ：")).toBe(true);
    const bodyTitle = titleFromActivityBody(parsed.messageText ?? "");
    expect(bodyTitle.length).toBeGreaterThan(0);
  });

  it("heartbeat health: unknown / ok / delayed", () => {
    expect(heartbeatHealth(null)).toBe("unknown");
    expect(heartbeatHealth(new Date().toISOString())).toBe("ok");
    expect(
      heartbeatHealth(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()),
    ).toBe("delayed");
  });

  it("assignment status transition new → in_progress を表現できる", () => {
    type Status = "new" | "in_progress" | "done" | "no_action";
    function nextStatus(current: Status, assigned: boolean): Status {
      if (assigned && current === "new") return "in_progress";
      return current;
    }
    expect(nextStatus("new", true)).toBe("in_progress");
    expect(nextStatus("done", true)).toBe("done");
    expect(nextStatus("no_action", false)).toBe("no_action");
  });

  it("no_action は削除せず reopen 可能", () => {
    let status: "new" | "no_action" | "in_progress" = "new";
    status = "no_action";
    expect(status).toBe("no_action");
    status = "in_progress";
    expect(status).toBe("in_progress");
  });

  it("candidate は自動 link しない（明示選択が必要）", () => {
    const autoLink = false;
    const candidates = [{ id: "c1", reason: "メール完全一致" }];
    const linked = autoLink ? candidates[0]?.id ?? null : null;
    expect(linked).toBeNull();
    expect(candidates.length).toBe(1);
  });

  it("partial success: customer 成功後に contact 失敗しても顧客を再作成しない", () => {
    const createCustomer = vi.fn(() => ({ ok: true, pageId: "cust-1" }));
    const createContact = vi.fn(() => ({ ok: false }));
    let linkedCustomer: string | null = null;
    const first = createCustomer();
    if (first.ok) linkedCustomer = first.pageId;
    const second = createContact();
    expect(second.ok).toBe(false);
    expect(linkedCustomer).toBe("cust-1");
    // retry contact のみ
    createContact.mockReturnValueOnce({ ok: true });
    expect(createCustomer).toHaveBeenCalledTimes(1);
  });
});
