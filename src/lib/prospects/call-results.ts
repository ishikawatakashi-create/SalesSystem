/**
 * Phase 13B call result semantics.
 * Master 化は将来。ここでは定数 + 副作用規則を単一情報源にする。
 */

export const CALL_RESULTS = [
  "no_answer",
  "busy",
  "gatekeeper",
  "contact_absent",
  "callback_requested",
  "connected",
  "send_materials",
  "interested",
  "appointment",
  "not_interested",
  "wrong_number",
  "do_not_contact",
  "other",
] as const;

export type CallResult = (typeof CALL_RESULTS)[number];

export const CALL_RESULT_LABELS: Record<CallResult, string> = {
  no_answer: "不通",
  busy: "話中",
  gatekeeper: "受付止まり",
  contact_absent: "担当者不在",
  callback_requested: "折返し希望",
  connected: "接触",
  send_materials: "資料送付",
  interested: "興味あり",
  appointment: "アポ獲得",
  not_interested: "興味なし",
  wrong_number: "番号違い",
  do_not_contact: "営業連絡不要",
  other: "その他",
};

/** 架電 UI の主要オプション（その他は secondary） */
export const PRIMARY_CALL_RESULTS: CallResult[] = [
  "no_answer",
  "gatekeeper",
  "contact_absent",
  "callback_requested",
  "connected",
  "send_materials",
  "interested",
  "appointment",
  "not_interested",
  "do_not_contact",
];

export const SECONDARY_CALL_RESULTS: CallResult[] = [
  "busy",
  "wrong_number",
  "other",
];

/** 数字ショートカット（1–7） */
export const CALL_RESULT_SHORTCUTS: Record<string, CallResult> = {
  "1": "no_answer",
  "2": "contact_absent",
  "3": "connected",
  "4": "send_materials",
  "5": "interested",
  "6": "appointment",
  "7": "not_interested",
};

/** KPI: 相手/担当へ到達した意味のある接触 */
export const CONNECTED_CLASS_RESULTS: readonly CallResult[] = [
  "connected",
  "send_materials",
  "interested",
  "appointment",
  "not_interested",
  "do_not_contact",
] as const;

export type MembershipStageSideEffect =
  | "working"
  | "qualified"
  | "disqualified"
  | "unchanged";

export type CallResultSideEffects = {
  membershipStage: MembershipStageSideEffect;
  requireNextContact: boolean;
  recommendNextContact: boolean;
  setDoNotContact: boolean;
  setPhoneInvalid: boolean;
  /** 昇格 CTA を強く出す */
  promoteCtaStrong: boolean;
};

export function getCallResultSideEffects(
  result: CallResult,
): CallResultSideEffects {
  switch (result) {
    case "no_answer":
    case "busy":
      return {
        membershipStage: "working",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
    case "gatekeeper":
    case "contact_absent":
      return {
        membershipStage: "working",
        requireNextContact: false,
        recommendNextContact: true,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
    case "callback_requested":
      return {
        membershipStage: "working",
        requireNextContact: true,
        recommendNextContact: true,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
    case "connected":
    case "send_materials":
      return {
        membershipStage: "working",
        requireNextContact: false,
        recommendNextContact: result === "send_materials",
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
    case "interested":
      return {
        membershipStage: "qualified",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: true,
      };
    case "appointment":
      return {
        membershipStage: "qualified",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: true,
      };
    case "not_interested":
      return {
        membershipStage: "disqualified",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
    case "wrong_number":
      return {
        membershipStage: "unchanged",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: false,
        setPhoneInvalid: true,
        promoteCtaStrong: false,
      };
    case "do_not_contact":
      return {
        membershipStage: "unchanged",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: true,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
    case "other":
      return {
        membershipStage: "unchanged",
        requireNextContact: false,
        recommendNextContact: false,
        setDoNotContact: false,
        setPhoneInvalid: false,
        promoteCtaStrong: false,
      };
  }
}

export function isCallResult(value: string): value is CallResult {
  return (CALL_RESULTS as readonly string[]).includes(value);
}

export function isConnectedClassResult(result: CallResult): boolean {
  return (CONNECTED_CLASS_RESULTS as readonly string[]).includes(result);
}
