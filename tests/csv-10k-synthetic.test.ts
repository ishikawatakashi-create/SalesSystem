import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv/parser";

describe("csv 10k行のパフォーマンステスト", () => {
  it("10,000行のCSVを10秒以内にパースできる", () => {
    // 10,000行のCSVを生成
    const headers = "ID,名前,年齢,都市,メール";
    const rows: string[] = [];

    for (let i = 1; i <= 10_000; i++) {
      // PIIやUUIDのログを避けるため、シンプルな連番データ
      rows.push(`${i},User${i},${20 + (i % 50)},City${i % 100},user${i}@test.local`);
    }

    const csv = `${headers}\n${rows.join("\n")}`;

    // パース時間を計測
    const startTime = Date.now();
    const result = parseCsv(csv);
    const elapsedTime = Date.now() - startTime;

    // 検証（内容はログに出さない）
    expect(result.headers).toHaveLength(5);
    expect(result.rows).toHaveLength(10_000);
    expect(result.rowNumbers[0]).toBe(2);
    expect(result.rowNumbers[9_999]).toBe(10_001);

    // パフォーマンス要件: 10秒以内
    expect(elapsedTime).toBeLessThan(10_000);
  }, 15_000); // タイムアウトを15秒に設定（余裕を持たせる）
});
