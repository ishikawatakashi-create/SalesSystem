# ADR 0002: Operational Prospect Pool lives in Supabase; Formal Organizations live in Notion

- Status: Accepted
- Date: 2026-08-09
- Phase: 13A

## Context

営業候補（スクレイピング結果・外部CSV・イベント名簿等）を大量に扱う必要があるが、未精査データを Notion 正式組織（Phase 12 Organization / technical entity `customer`）へ直接入れると SSoT が汚染される。

## Decision

1. **正式組織** = Notion SSoT（`customer` / product: Organization）。権限・write pipeline・webhook は既存のまま。
2. **Prospect Pool** = Supabase operational data。Notion へは書かない。
3. Prospect は **canonical**。同一会社が複数営業リストに出ても Prospect を増やさず、`prospect_list_memberships` で所属させる。
4. 重複排除の自動 merge は **high confidence のみ**（exact domain / company phone / contact email）。会社名のみ一致は probable flag（自動 merge 禁止）。
5. Phase 8 `import_jobs` は Notion write 前提のため再利用せず、`prospect_import_*` を分離。parser/encoding/storage bucket パターンのみ共有。
6. 正式組織への昇格・架電 UI は **Phase 13B**。

## Consequences

- Global Search に「営業候補」を追加し、正式組織とラベルで区別する。
- DNC は Prospect グローバル。全リストで再接触を抑止。
- 既存 CRM（顧客/案件/お問い合わせ等）の schema は原則変更しない。
