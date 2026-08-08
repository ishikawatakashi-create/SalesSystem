# ADR 0001: Organization is a product concept over the existing customer technical entity

- Status: Accepted
- Date: 2026-08-08
- Phase: 12

## Context

SalesSystem の「顧客」は Notion `customers` DB / `customer_index` / write pipeline / webhook /
permissions / audit / CSV に深く結合している。Product 上は顧客以外の関係先
（見込・メディア・自治体・学校・パートナー等）も同一の正式組織として扱いたい。

一方で technical entity を全面 rename すると、Notion relation・external_id・
webhook entity 名・既存 URL / audit action・大量のコード変更が発生し、
既存 CRM 回帰リスクが高い。

## Decision

- **technical entity = `customer`**（DB / API / permissions / audit / converters は維持）
- **product concept = Organization（組織）**
- 組織の「関係性」は masters 種別 `関係性` + customers multi relation `関係性`
- Supabase `customer_index.relationship_ids` / `relationship_semantic_keys` は非正規化 index
- 正式 SSoT は Notion。Supabase のみの書き換えで完結させない
- 新 permission `organization.*` は作らない（`customer.view` / `customer.edit` を使用）
- `/organizations` を product route とし、`/customers` は互換 redirect

## Consequences

- UI 文言とナビは「組織」中心になる
- コード・ジョブ・監査アクション名に `customer` が残る（意図的）
- Phase 13 Prospect Pool（Supabase）から正式組織へ昇格するときの受け皿は
  本 customer entity + `relationship=prospect`

## Phase 13 boundary

| 領域 | 保管 | 備考 |
|---|---|---|
| Formal Organization | Notion（customer entity） | 本 ADR |
| Operational Prospect Pool | Supabase | scraping / 外部リスト / 架電キュー。Phase 13 |
| Promotion | Prospect → Organization | `relationship=prospect` を付与して Notion 作成 |
