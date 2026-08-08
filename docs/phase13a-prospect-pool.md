# Phase 13A: Prospect Pool / 営業リスト基盤（Release notes）

改訂: 2026-08-09

## 概要

未精査の営業候補を Supabase で管理し、営業リストへ配布・割当できる基盤。

- ADR: [docs/adr/0002-prospect-pool-supabase.md](./adr/0002-prospect-pool-supabase.md)
- 正式組織は Notion（Phase 12）。Prospect は **Notion 非書込**
- Routes: `/prospect-lists`, `/prospects`
- Jobs: `prospect_csv_import`, `prospect_bulk_assign`（chunk + resume）

## Tables

- `prospect_lists`
- `prospects`（canonical）
- `prospect_contacts`
- `prospect_list_memberships`（list 固有 stage/担当/source）
- `prospect_import_jobs` / `prospect_import_rows`

## Dedupe

| Signal | Action |
|---|---|
| exact domain | high → Prospect reuse + membership |
| exact company phone | high → reuse |
| exact contact email | high → reuse |
| company name only | probable flag（自動 merge しない） |

## Permissions

| Action | admin | a | b | viewer |
|---|:-:|:-:|:-:|:-:|
| prospect.view | ○ | ○ | ○ | ○ |
| prospect.edit | ○ | ○ | ○ | × |
| prospect.import | ○ | ○ | × | × |
| prospect.assign（一括） | ○ | ○ | × | × |
| prospect.manage_lists | ○ | ○ | × | × |

単一担当変更は `prospect.edit`（B 可）。一括/均等は `prospect.assign`。

## Phase 13B 境界（未実装）

架電 UI / call_attempts / 昇格 / KPI（接続率・アポ率）等。
