import { sanitizeIlikeTerm } from "../src/lib/search/escape";
import {
  aggregateCountsByKey,
  prioritizeMyActions,
  sumPipelineAmount,
} from "../src/lib/mydesk/pure";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const N = 10_000;
const rows = Array.from({ length: N }, (_, i) => ({
  id: `c${i}`,
  search_text: `customer_${i} 架空法人 ${i % 97}`,
  status: i % 5 === 0 ? "active" : i % 5 === 1 ? "on_hold" : "won",
  amount: i % 7 === 0 ? null : i % 3,
}));

const t0 = performance.now();
const q = sanitizeIlikeTerm("架空");
const hits = rows.filter((r) => r.search_text.includes(q));
const t1 = performance.now();

assert(hits.slice(0, 50).length <= 50, "page size");

const amounts = rows
  .filter((r) => r.status === "active" || r.status === "on_hold")
  .map((r) => ({ expected_amount: r.amount }));
const sum = sumPipelineAmount(amounts);
assert(typeof sum.sum === "number", "sum");

const byStatus = aggregateCountsByKey(rows.map((r) => r.status));
assert(byStatus.size >= 3, "status keys");

const actions = Array.from({ length: 500 }, (_, i) => ({
  dueDate:
    i % 3 === 0 ? "2020-01-01" : i % 3 === 1 ? "2099-01-01" : "2026-08-07",
  assigneeUserId: i % 2 === 0 ? "u1" : "u2",
}));
assert(prioritizeMyActions(actions, "u1").length === 500, "prioritize");

console.log(
  JSON.stringify({
    ok: true,
    n: N,
    filter_ms: Math.round(t1 - t0),
    hits: hits.length,
    sum_total: sum.sum,
    null_count: sum.nullCount,
  }),
);
