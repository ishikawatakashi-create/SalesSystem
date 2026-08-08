# Phase 13B — インサイドセールス実行 / 架電管理 / Prospect昇格

## 概要

Phase 13A Prospect Pool を土台に、架電キュー・結果入力・再架電・正式 Organization 昇格を実装する。

- Prospect 段階では **Notion へ書かない**
- 架電履歴は `prospect_call_attempts`（Supabase operational）
- 昇格時のみ既存 customer / contact / activity / action / deal write pipeline を使用

## Call result semantics

| result | 日本語 | stage | next_contact | その他 |
|---|---|---|---|---|
| no_answer | 不通 | working | 任意 | |
| busy | 話中 | working | 任意 | |
| gatekeeper | 受付止まり | working | 推奨 | |
| contact_absent | 担当者不在 | working | 推奨 | |
| callback_requested | 折返し希望 | working | **必須** | |
| connected | 接触 | working | 任意 | |
| send_materials | 資料送付 | working | 推奨 | メール送信なし |
| interested | 興味あり | qualified | 任意 | 自動昇格なし |
| appointment | アポ獲得 | qualified | 任意 | 昇格CTA強 |
| not_interested | 興味なし | disqualified | | グローバルDNCにしない |
| wrong_number | 番号違い | 維持 | | phone_invalid |
| do_not_contact | 営業連絡不要 | 維持 | | prospect.do_not_contact |
| other | その他 | 維持 | | |

## Queue ordering

`claim_next_prospect_call` RPC（`FOR UPDATE SKIP LOCKED`）:

1. next_contact_at overdue
2. next_contact_at today (JST)
3. assigned/new 未着手
4. working
5. その他

同順位: priority → next_contact_at → updated_at → created_at

除外 default: DNC / archived / qualified / disqualified / converted / promoted / future next_contact（filter=eligible）

Claim lease: 10分。永久 lock 禁止。

## KPI definitions

- **attempt_count**: 期間内 call_attempts 件数（raw）
- **attempted_prospect_count**: 期間内に1回以上架電した unique Prospect
- **connected_prospect_count**: connected-class result を持つ unique Prospect  
  connected-class = connected / send_materials / interested / appointment / not_interested / do_not_contact
- **connection_rate** = connected_prospect_count / attempted_prospect_count
- **appointment_rate** = appointment unique / connected unique

同じ会社へ複数回架電しても分母を raw attempts では膨らませない（rate は unique）。

## Formal Organization matching

`customer_index.normalized_domain`（website/email host から derived）。

high confidence:

- exact normalized_domain
- exact phone_normalized
- formal contact email exact

probable:

- company name (+ address)

company name only は high にしない。Notion は SSoT、matching key は derived index。

## Promotion

手動のみ。job `prospect_promote`。

- link_existing / create_new（relationship default: prospect）
- 選択 contact → formal Contact
- 直近1/3件 → Activity（全履歴コピー禁止）
- next_contact → Action（任意）
- Deal（任意・default OFF）
- 全 active membership → stage `converted`
- request_id で idempotent / partial resume

## Permissions

- `prospect.call` / `prospect.promote`: admin / a / b
- promote は加えて `customer.edit`（必要に応じ contact/activity/action/deal.edit）を server-side 二重 check

## Routes

- `/call-queue` — 自分の架電キュー入口
- `/call-queue/[membershipId]` — 架電専用 UI（保存して次へ）

## Notion non-pollution

通常の架電保存・next_contact・qualified では Notion write 0。  
昇格開始時のみ formal pipeline。
