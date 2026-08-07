import { describe, expect, it } from "vitest";
import {
  buildSourceKey,
  hashSourceKey,
  deterministicExternalId,
} from "@/lib/csv/source-key";

describe("buildSourceKey", () => {
  it("ソースシステムありのキーを構築できる", () => {
    const key = buildSourceKey({
      sourceSystem: "kintone",
      sourceRecordId: "12345",
    });

    expect(key).toBe("csv:kintone:12345");
  });

  it("ソースシステムなしのキーを構築できる", () => {
    const key = buildSourceKey({
      sourceRecordId: "67890",
    });

    expect(key).toBe("csv::67890");
  });
});

describe("hashSourceKey", () => {
  it("ソースキーをSHA256ハッシュ化できる", () => {
    const key = "csv:kintone:12345";
    const hash = hashSourceKey(key);

    expect(hash).toHaveLength(64); // SHA256は64文字のhex
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じキーは同じハッシュになる", () => {
    const key = "csv:kintone:12345";
    const hash1 = hashSourceKey(key);
    const hash2 = hashSourceKey(key);

    expect(hash1).toBe(hash2);
  });

  it("異なるキーは異なるハッシュになる", () => {
    const hash1 = hashSourceKey("csv:kintone:12345");
    const hash2 = hashSourceKey("csv:kintone:67890");

    expect(hash1).not.toBe(hash2);
  });
});

describe("deterministicExternalId", () => {
  it("ソースキーがある場合はそれをベースにする", () => {
    const importJobId = "job-123";
    const rowNumber = 5;
    const sourceKey = "csv:kintone:12345";

    const id1 = deterministicExternalId(importJobId, rowNumber, sourceKey);
    const id2 = deterministicExternalId(importJobId, rowNumber, sourceKey);

    expect(id1).toBe(id2); // 決定的
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ); // UUID形式
  });

  it("ソースキーがない場合は行番号ベース", () => {
    const importJobId = "job-123";
    const rowNumber = 5;

    const id1 = deterministicExternalId(importJobId, rowNumber);
    const id2 = deterministicExternalId(importJobId, rowNumber);

    expect(id1).toBe(id2); // 決定的
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("異なる行番号は異なるIDを生成する", () => {
    const importJobId = "job-123";

    const id1 = deterministicExternalId(importJobId, 1);
    const id2 = deterministicExternalId(importJobId, 2);

    expect(id1).not.toBe(id2);
  });

  it("異なるジョブIDは異なるIDを生成する", () => {
    const rowNumber = 5;

    const id1 = deterministicExternalId("job-123", rowNumber);
    const id2 = deterministicExternalId("job-456", rowNumber);

    expect(id1).not.toBe(id2);
  });
});
