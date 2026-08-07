import { describe, expect, it } from "vitest";
import { parseCsv, CsvParseError } from "@/lib/csv/parser";

describe("parseCsv", () => {
  it("基本的なCSVをパースできる", () => {
    const csv = "名前,年齢,都市\n山田太郎,30,東京\n佐藤花子,25,大阪";
    const result = parseCsv(csv);

    expect(result.headers).toEqual(["名前", "年齢", "都市"]);
    expect(result.rows).toEqual([
      ["山田太郎", "30", "東京"],
      ["佐藤花子", "25", "大阪"],
    ]);
    expect(result.rowNumbers).toEqual([2, 3]);
  });

  it("引用符付きフィールドをパースできる", () => {
    const csv = '名前,説明\n"田中,一郎","複数行\nテキスト"';
    const result = parseCsv(csv);

    expect(result.headers).toEqual(["名前", "説明"]);
    expect(result.rows).toEqual([["田中,一郎", "複数行\nテキスト"]]);
  });

  it("エスケープされた引用符を処理できる", () => {
    const csv = '名前,メッセージ\n"山田","彼は""こんにちは""と言った"';
    const result = parseCsv(csv);

    expect(result.rows[0]).toEqual(["山田", '彼は"こんにちは"と言った']);
  });

  it("CRLF と LF の両方を処理できる", () => {
    const csvCrlf = "A,B\r\n1,2\r\n3,4";
    const csvLf = "A,B\n1,2\n3,4";

    const resultCrlf = parseCsv(csvCrlf);
    const resultLf = parseCsv(csvLf);

    expect(resultCrlf.rows).toEqual(resultLf.rows);
  });

  it("BOM を除去する", () => {
    const csv = "\uFEFF名前,年齢\n山田,30";
    const result = parseCsv(csv);

    expect(result.headers).toEqual(["名前", "年齢"]);
  });

  it("空行を除去する", () => {
    const csv = "A,B\n1,2\n\n3,4\n";
    const result = parseCsv(csv);

    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("重複するヘッダーを検出する", () => {
    const csv = "名前,年齢,名前\n太郎,30,次郎";

    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/重複/);
  });

  it("空のヘッダーを検出する", () => {
    const csv = "名前,,年齢\n太郎,X,30";

    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/空のヘッダー/);
  });

  it("最大行数を超えるとエラー", () => {
    const headers = "A,B,C";
    const rows = Array(10001)
      .fill("1,2,3")
      .join("\n");
    const csv = `${headers}\n${rows}`;

    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/行数が上限/);
  });

  it("最大列数を超えるとエラー", () => {
    const headers = Array(81)
      .fill("A")
      .map((v, i) => `${v}${i}`)
      .join(",");
    const csv = `${headers}\n${headers}`;

    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/列数が上限/);
  });

  it("セルの最大文字数を超えるとエラー", () => {
    const longText = "a".repeat(8001);
    const csv = `名前\n"${longText}"`;

    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/セルの文字数が上限/);
  });

  it("引用符が閉じられていない場合エラー", () => {
    const csv = '名前,説明\n"山田,未閉鎖';

    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/引用符が閉じられていません/);
  });

  it("空のCSVはエラー", () => {
    expect(() => parseCsv("")).toThrow(CsvParseError);
    expect(() => parseCsv("")).toThrow(/空です/);
  });
});
