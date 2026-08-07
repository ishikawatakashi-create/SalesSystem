export type InquiryStatus = "new" | "in_progress" | "done" | "no_action";

export type InquiryParseStatus = "ok" | "warning" | "failed";

export type InquirySourceConfidence = "high" | "medium" | "low";

export type InquirySource = "strikingly_email";

export type InquiryAttachmentMeta = {
  filename: string | null;
  mimeType: string | null;
  size: number | null;
};

export type InquiryRow = {
  id: string;
  source: string;
  source_message_id: string;
  source_thread_id: string | null;
  received_at: string;
  subject: string | null;
  sender_name: string | null;
  sender_email: string | null;
  reply_to_email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  company_name: string | null;
  form_name: string | null;
  message_text: string | null;
  form_fields: Record<string, unknown>;
  attachment_meta: InquiryAttachmentMeta[];
  status: InquiryStatus;
  assigned_user_id: string | null;
  linked_customer_page_id: string | null;
  linked_contact_page_id: string | null;
  linked_activity_page_id: string | null;
  handled_at: string | null;
  no_action_reason: string | null;
  parse_status: InquiryParseStatus;
  parse_warning_code: string | null;
  source_confidence: InquirySourceConfidence;
  created_at: string;
  updated_at: string;
};

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "未確認",
  in_progress: "対応中",
  done: "対応済",
  no_action: "対応不要",
};

export type CustomerCandidate = {
  kind: "customer" | "contact";
  customerPageId: string;
  contactPageId: string | null;
  displayName: string;
  reason: string;
  strength: "strong" | "weak";
};

export type GmailIntegrationStatus =
  | "disconnected"
  | "connected"
  | "needs_reconnect";

export type GmailIntegrationSettings = {
  status?: GmailIntegrationStatus;
  vault_secret_name?: string;
  connected_at?: string;
  email_masked?: string;
  label_id?: string | null;
  label_name?: string | null;
  ingestion_enabled?: boolean;
  watch_expiration?: string | null;
  history_id?: string | null;
  last_history_id?: string | null;
  last_notification_at?: string | null;
  last_history_sync_at?: string | null;
  last_reconciliation_at?: string | null;
  last_error_code?: string | null;
  last_error_at?: string | null;
  needs_reconnect?: boolean;
  cleared_at?: string;
};

/** 対応不要の表示用候補（semantic固定ではない） */
export const NO_ACTION_REASON_SUGGESTIONS = [
  "営業メール",
  "spam",
  "重複",
  "その他",
] as const;
