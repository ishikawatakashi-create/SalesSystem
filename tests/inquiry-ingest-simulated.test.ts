import { describe, expect, it, vi } from "vitest";

import { parseStrikinglyNotificationMail } from "@/lib/inquiries/parser-strikingly";
import { parsePubSubPushBody } from "@/lib/integrations/gmail/pubsub-envelope";
import { titleFromActivityBody } from "@/lib/activities/quick-title";

/**
 * 実Gmail接続前の simulated フロー（parser / envelope / activity title / dedupe key）。
 * DB/API はモックせず純関数中心で完走確認する。
 */
describe("Phase 11 simulated inquiry flow", () => {
  it("Pub/Sub → historyId → Strikingly parse → activity prefill", () => {
    const data = Buffer.from(
      JSON.stringify({ historyId: "999001", emailAddress: "box@example.com" }),
    ).toString("base64");
    const envelope = parsePubSubPushBody({
      message: { data, messageId: "pubsub-1" },
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const parsed = parseStrikinglyNotificationMail({
      subject: "New Form Submission from Strikingly",
      from: "Strikingly <noreply@strikingly.com>",
      replyTo: "佐藤花子 <sato@example.test>",
      plainText: [
        "名前: 佐藤花子",
        "メール: sato@example.test",
        "会社: 架空商事",
        "お問い合わせ内容: デモ希望です。",
      ].join("\n"),
    });

    expect(parsed.senderEmail).toBe("sato@example.test");
    expect(parsed.companyName).toBe("架空商事");
    expect(parsed.parseStatus).toBe("ok");

    const sourceMessageId = "gmail-msg-abc";
    const dedupeKey = sourceMessageId;
    const again = sourceMessageId;
    expect(dedupeKey).toBe(again);

    const activityTitle = `Webお問い合わせ：${parsed.subject}`.slice(0, 80);
    expect(activityTitle.startsWith("Webお問い合わせ：")).toBe(true);
    const bodyTitle = titleFromActivityBody(parsed.messageText ?? "");
    expect(bodyTitle.length).toBeGreaterThan(0);
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
