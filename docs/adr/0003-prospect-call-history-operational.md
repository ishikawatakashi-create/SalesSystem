# ADR 0003: Prospect call history remains operational in Supabase

## Status

Accepted (Phase 13B)

## Context

インサイドセールスの架電は高頻度・短文・再試行が多く、正式 CRM（Notion Activity）へ毎回書くと:

- Notion rate limit / コストが増える
- Activity がノイズで埋まる
- Prospect 段階の試行錯誤が正式履歴として固定される

## Decision

1. `prospect_call_attempts` は Supabase 上の operational history とする
2. 通常の架電・再架電・DNC・stage 変更では Notion へ書かない
3. Prospect → Organization 昇格時、ユーザーが選択した最近の意味ある接触のみ既存 Activity pipeline で正式履歴化する（default 直近1件、最大3件）
4. 全 call history の Notion 一括コピーは行わない

## Consequences

- Prospect 詳細の接触履歴は Supabase から paginate 表示
- 昇格前の監査・KPI は Supabase 集計
- 正式 Organization の Activity はビジネス上意味のある接点に限定される
