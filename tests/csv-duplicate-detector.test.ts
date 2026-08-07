import { describe, expect, it } from "vitest";
import {
  detectDuplicateCustomers,
  detectIntraFileDuplicates,
} from "@/lib/csv/duplicate-detector";

describe("detectDuplicateCustomers", () => {
  it("電話番号の完全一致を検出する（高信頼度）", () => {
    const input = {
      customerId: "new",
      phone: "03-1234-5678",
    };

    const existing = [
      {
        customerId: "existing-1",
        phone: "03-1234-5678",
      },
    ];

    const candidates = detectDuplicateCustomers(input, existing);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.confidence).toBe("high");
    expect(candidates[0]?.reason).toMatch(/電話番号/);
    expect(candidates[0]?.customerId).toBe("existing-1");
  });

  it("法人名+事業所名の一致を検出する（高信頼度）", () => {
    const input = {
      customerId: "new",
      legalName: "株式会社テスト",
      officeName: "本社",
    };

    const existing = [
      {
        customerId: "existing-1",
        legalName: "株式会社テスト",
        officeName: "本社",
      },
    ];

    const candidates = detectDuplicateCustomers(input, existing);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.confidence).toBe("high");
    expect(candidates[0]?.reason).toMatch(/法人名と事業所名/);
  });

  it("法人名+都道府県の一致を検出する（中信頼度）", () => {
    const input = {
      customerId: "new",
      legalName: "株式会社テスト",
      prefecture: "東京都",
    };

    const existing = [
      {
        customerId: "existing-1",
        legalName: "株式会社テスト",
        prefecture: "東京都",
      },
    ];

    const candidates = detectDuplicateCustomers(input, existing);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.confidence).toBe("medium");
    expect(candidates[0]?.reason).toMatch(/法人名と都道府県/);
  });

  it("表示名の類似を検出する（低信頼度）", () => {
    const input = {
      customerId: "new",
      displayName: "テスト株式会社",
    };

    const existing = [
      {
        customerId: "existing-1",
        displayName: "テスト株式会社",
      },
    ];

    const candidates = detectDuplicateCustomers(input, existing);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.confidence).toBe("low");
    expect(candidates[0]?.reason).toMatch(/表示名/);
  });

  it("複数の候補を優先順位順に返す", () => {
    const input = {
      customerId: "new",
      displayName: "株式会社テスト",
      legalName: "株式会社テスト",
      phone: "03-1234-5678",
      prefecture: "東京都",
    };

    const existing = [
      {
        customerId: "phone-match",
        phone: "03-1234-5678",
      },
      {
        customerId: "name-match",
        displayName: "株式会社テスト",
      },
    ];

    const candidates = detectDuplicateCustomers(input, existing);

    expect(candidates).toHaveLength(2);
    // 最初に見つかった電話番号一致が最初に来る
    expect(candidates[0]?.customerId).toBe("phone-match");
  });

  it("マッチしない場合は空配列を返す", () => {
    const input = {
      customerId: "new",
      displayName: "株式会社A",
    };

    const existing = [
      {
        customerId: "existing-1",
        displayName: "株式会社B",
      },
    ];

    const candidates = detectDuplicateCustomers(input, existing);

    expect(candidates).toHaveLength(0);
  });
});

describe("detectIntraFileDuplicates", () => {
  it("ファイル内の重複を検出する", () => {
    const rows = [
      { customerId: "row-1", phone: "03-1234-5678" },
      { customerId: "row-2", phone: "03-9999-9999" },
      { customerId: "row-3", phone: "03-1234-5678" }, // row-1と重複
    ];

    const groups = detectIntraFileDuplicates(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain(0); // row-1
    expect(groups[0]).toContain(2); // row-3
  });

  it("複数の重複グループを検出する", () => {
    const rows = [
      { customerId: "row-1", phone: "03-1111-1111" },
      { customerId: "row-2", phone: "03-1111-1111" }, // row-1と重複
      { customerId: "row-3", phone: "03-2222-2222" },
      { customerId: "row-4", phone: "03-2222-2222" }, // row-3と重複
    ];

    const groups = detectIntraFileDuplicates(rows);

    expect(groups).toHaveLength(2);
  });

  it("重複がない場合は空配列を返す", () => {
    const rows = [
      { customerId: "row-1", phone: "03-1111-1111" },
      { customerId: "row-2", phone: "03-2222-2222" },
      { customerId: "row-3", phone: "03-3333-3333" },
    ];

    const groups = detectIntraFileDuplicates(rows);

    expect(groups).toHaveLength(0);
  });
});
