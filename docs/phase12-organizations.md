# Phase 12: 組織管理への拡張（Release notes）

改訂: 2026-08-08

## 概要

technical entity `customer` を維持したまま、product 概念を **組織（Organization）** へ拡張した。

- ADR: [docs/adr/0001-organization-over-customer-entity.md](./adr/0001-organization-over-customer-entity.md)
- 関係性 master（semantic_key）: customer / prospect / media / municipality / education_research / partner / supplier / other
- Notion customers multi relation「関係性」
- Supabase `customer_index.relationship_ids` / `relationship_semantic_keys`
- UI: `/organizations`、ナビ「組織」、`/customers` 互換 redirect
- 既存顧客へ Notion 経由で default `customer` を backfill（job: `customer.backfill_default_relationship`）

## CSV

Phase 12 では関係性マッピング列を追加しない。create 時空の場合 `customer` を default。  
列マッピング拡張は Phase 13 候補（肥大化回避）。

## 運用手順（Production）

1. migration `20260808200000_phase12_organization_relationship.sql` 適用
2. `npx tsx scripts/apply-phase12-organization-relationship.ts --apply`
3. masters cache sync
4. `npx tsx scripts/enqueue-relationship-backfill.ts`（必要なら `--dry-run` 先行）
5. Vercel deploy 後、テスト組織で E2E

## Phase 13 へ引き継ぐこと

- Prospect Pool（Supabase）
- Prospect → Organization promotion（`relationship=prospect`）
- CSV 関係性マッピング列
- supplier / other 専用ナビ（現状は「すべて」+ filter）
