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
4. Vercel deploy（job handler 反映）
5. `npx tsx scripts/enqueue-relationship-backfill.ts`（必要なら `--dry-run` 先行）
6. ワーカー処理。Vercel 60s 制約で詰まる場合はローカル:
   `$env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'; npx tsx scripts/run-relationship-backfill-local.ts`
7. E2E: `npx tsx scripts/e2e-phase12-organizations.ts`

## Production 適用結果（2026-08-08）

| 項目 | 結果 |
|---|---|
| commit | `74fb73e`（本体）+ follow-up（chunk/E2E） |
| migration | `20260808200000_phase12_organization_relationship` Local=Remote |
| Notion | 関係性 master option + customers relation + seed 8 |
| masters_cache | 関係性 8 |
| backfill | empty 28→0 / updated 28（worker 6 + local 22）/ failed 0 |
| E2E | `Phase12 組織テスト` media+prospect、要件1–14、archive |

## Phase 13 へ引き継ぐこと

- Prospect Pool（Supabase）
- Prospect → Organization promotion（`relationship=prospect`）
- CSV 関係性マッピング列
- supplier / other 専用ナビ（現状は「すべて」+ filter）
- backfill job の Production chunk サイズ / maxDuration チューニング（現状 CHUNK_SIZE=5）
