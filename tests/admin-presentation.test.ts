import { describe, expect, it } from "vitest";

import {
  csvActionErrorMessage,
  csvImportFailureReason,
  csvMappingErrorMessage,
  importJobStatusPresentation,
  importPreviewSummaryLabel,
  importRowStatusPresentation,
  userRegistrationStatusLabel,
  webhookSetupStatusLabel,
  type AdminStatusPresentation,
} from "@/lib/admin-presentation";

describe("CSV import status presentation", () => {
  it("import jobの全既知状態を日本語ラベルとtoneに変換する", () => {
    const expected = {
      pending: { label: "受付待ち", tone: "neutral" },
      uploaded: { label: "アップロード済み", tone: "neutral" },
      analyzing: { label: "ファイル解析中", tone: "processing" },
      parsing: { label: "ファイル解析中", tone: "processing" },
      mapping_required: {
        label: "列の対応付けが必要",
        tone: "warning",
      },
      validating: { label: "内容を確認中", tone: "processing" },
      validation_completed: { label: "内容確認済み", tone: "neutral" },
      ready: { label: "取込準備完了", tone: "neutral" },
      importing: { label: "取込中", tone: "processing" },
      partially_completed: { label: "一部完了", tone: "warning" },
      completed: { label: "取込完了", tone: "success" },
      cancelled: { label: "キャンセル済み", tone: "neutral" },
      failed: { label: "失敗", tone: "danger" },
    } satisfies Record<string, AdminStatusPresentation>;

    for (const [raw, presentation] of Object.entries(expected)) {
      expect(importJobStatusPresentation(raw), raw).toEqual(presentation);
      expect(presentation.label, raw).not.toBe(raw);
    }
  });

  it("import rowの全既知状態を日本語ラベルとtoneに変換する", () => {
    const expected = {
      pending: { label: "未処理", tone: "neutral" },
      valid_new: { label: "新規登録予定", tone: "neutral" },
      valid_update: { label: "更新予定", tone: "neutral" },
      duplicate: { label: "重複候補", tone: "warning" },
      invalid: { label: "取込不可", tone: "danger" },
      skipped: { label: "対象外", tone: "neutral" },
      importing: { label: "取込中", tone: "processing" },
      imported: { label: "取込済み", tone: "success" },
      import_failed: { label: "取込失敗", tone: "danger" },
    } satisfies Record<string, AdminStatusPresentation>;

    for (const [raw, presentation] of Object.entries(expected)) {
      expect(importRowStatusPresentation(raw), raw).toEqual(presentation);
      expect(presentation.label, raw).not.toBe(raw);
    }
  });

  it("未知・空のjob/row状態はraw値ではなく要確認表示にする", () => {
    const fallback = { label: "状態要確認", tone: "warning" };
    for (const present of [
      importJobStatusPresentation,
      importRowStatusPresentation,
    ]) {
      expect(present("unknown_internal_status")).toEqual(fallback);
      expect(present("")).toEqual(fallback);
      expect(present(null)).toEqual(fallback);
      expect(present(undefined)).toEqual(fallback);
      expect(present("unknown_internal_status").label).not.toContain(
        "unknown_internal_status",
      );
    }
  });
});

describe("CSV import summary and error presentation", () => {
  it("preview集計の全既知keyを日本語に変換する", () => {
    const expected = {
      total: "総行数",
      valid: "取込可能",
      warning: "要確認",
      error: "エラー",
      valid_new: "新規登録予定",
      valid_update: "更新予定",
      duplicate: "重複候補",
      skipped: "対象外",
      relation_unresolved: "関連データ未特定",
      mapping_errors: "列の対応付けエラー",
    } as const;

    for (const [raw, label] of Object.entries(expected)) {
      expect(importPreviewSummaryLabel(raw), raw).toBe(label);
      expect(label, raw).not.toBe(raw);
    }
    expect(importPreviewSummaryLabel("unknown_summary_key")).toBe(
      "その他の集計",
    );
  });

  it("列mapping errorを項目名付きの行動可能な日本語に変換する", () => {
    expect(csvMappingErrorMessage("required_missing", "会社名")).toBe(
      "必須項目「会社名」に対応するCSV列を選択してください。",
    );
    expect(csvMappingErrorMessage("required_missing")).toBe(
      "必須項目に対応するCSV列を選択してください。",
    );
    expect(csvMappingErrorMessage("duplicate_target", "電話番号")).toBe(
      "「電話番号」に複数のCSV列が割り当てられています。1列だけ選択してください。",
    );
    expect(csvMappingErrorMessage("duplicate_target")).toBe(
      "同じ項目に複数のCSV列が割り当てられています。1列だけ選択してください。",
    );
    expect(csvMappingErrorMessage("unsupported_field", "内部項目")).toBe(
      "「内部項目」はCSV取込の対象外です。",
    );
    expect(csvMappingErrorMessage("unsupported_field")).toBe(
      "選択した項目はCSV取込の対象外です。",
    );

    const fallback =
      "列の対応付けを保存できませんでした。選択内容を確認してください。";
    expect(csvMappingErrorMessage("unknown_mapping_error")).toBe(fallback);
    expect(csvMappingErrorMessage(null)).toBe(fallback);
    expect(csvMappingErrorMessage(undefined)).toBe(fallback);
    expect(csvMappingErrorMessage("unknown_mapping_error")).not.toContain(
      "unknown_mapping_error",
    );
  });

  it("CSV action errorの全既知codeと未知値を日本語に変換する", () => {
    const expected = {
      invalid_entity: "取込対象を選び直してください。",
      csv_only: "CSV形式のファイルを選択してください。",
      file_size:
        "CSVファイルが空でないこと、20MB以下であることを確認してください。",
      not_found: "取込データが見つかりません。表示を更新してください。",
      forbidden: "この取込を操作する権限がありません。",
      already_completed: "このCSVの取込は完了しています。",
      not_ready: "まだ取込を開始できません。先に内容確認を完了してください。",
    } as const;

    for (const [raw, message] of Object.entries(expected)) {
      expect(csvActionErrorMessage(raw), raw).toBe(message);
      expect(message, raw).not.toContain(raw);
    }

    const fallback =
      "操作を完了できませんでした。表示を更新して、もう一度お試しください。";
    expect(csvActionErrorMessage("unknown_action_error")).toBe(fallback);
    expect(csvActionErrorMessage("")).toBe(fallback);
    expect(csvActionErrorMessage(null)).toBe(fallback);
    expect(csvActionErrorMessage(undefined)).toBe(fallback);
    expect(csvActionErrorMessage("unknown_action_error")).not.toContain(
      "unknown_action_error",
    );
  });
});

describe("CSV import failure reason presentation", () => {
  it("全既知理由codeを内部値ではなく日本語に変換する", () => {
    const expected = {
      required_missing: "必須項目が入力されていません",
      unsupported_field: "CSV取込の対象外の項目です",
      master_not_found: "登録済みの選択肢が見つかりません",
      master_ambiguous: "同名の選択肢が複数あります",
      master_inactive: "利用停止中の選択肢です",
      relation_unresolved: "関連データを特定できません",
      relation_ambiguous: "関連データの候補が複数あります",
      invalid_boolean: "はい／いいえの値を確認してください",
      invalid_number: "数値の形式を確認してください",
      body_truncated: "長い本文の一部を省略しました",
      duplicate_candidate: "既存データと重複する可能性があります",
      duplicate_ambiguous: "重複候補を一つに特定できません",
      unknown_entity: "取込対象を判定できませんでした",
      import_failed: "システムへの登録処理に失敗しました",
    } as const;

    for (const [raw, message] of Object.entries(expected)) {
      const result = csvImportFailureReason(raw);
      expect(result, raw).toBe(message);
      expect(result, raw).not.toContain(raw);
    }
  });

  it("項目名変換・複数理由・重複除外・未知値を安全に表示する", () => {
    expect(
      csvImportFailureReason(
        "company_name:required_missing,phone:invalid_number,company_name:required_missing",
        { company_name: "会社名", phone: "電話番号" },
      ),
    ).toBe(
      "会社名: 必須項目が入力されていません / 電話番号: 数値の形式を確認してください",
    );
    expect(csvImportFailureReason("unknown_internal_reason")).toBe(
      "システムへの登録処理に失敗しました",
    );
    expect(csvImportFailureReason("unknown_internal_reason")).not.toContain(
      "unknown_internal_reason",
    );

    const emptyFallback =
      "取込できなかった理由を確認できませんでした。技術情報を確認してください。";
    expect(csvImportFailureReason("")).toBe(emptyFallback);
    expect(csvImportFailureReason("   ")).toBe(emptyFallback);
    expect(csvImportFailureReason(null)).toBe(emptyFallback);
    expect(csvImportFailureReason(undefined)).toBe(emptyFallback);
  });
});

describe("webhook setup status presentation", () => {
  it("全既知statusをraw codeではなく日本語で表示する", () => {
    const expected = {
      awaiting: "設定待ち",
      received: "確認用情報を受信済み",
      verified: "検証済み",
    } as const;

    for (const [raw, label] of Object.entries(expected)) {
      expect(webhookSetupStatusLabel(raw), raw).toBe(label);
      expect(label, raw).not.toBe(raw);
    }
  });

  it("未知・空statusはraw codeを出さず要確認表示にする", () => {
    expect(webhookSetupStatusLabel("unknown_webhook_status")).toBe(
      "状態要確認",
    );
    expect(webhookSetupStatusLabel("")).toBe("状態要確認");
    expect(webhookSetupStatusLabel(null)).toBe("状態要確認");
    expect(webhookSetupStatusLabel(undefined)).toBe("状態要確認");
    expect(webhookSetupStatusLabel("unknown_webhook_status")).not.toContain(
      "unknown_webhook_status",
    );
  });
});

describe("user registration status presentation", () => {
  it("内部状態を利用者向けの日本語に変換する", () => {
    for (const status of [
      "pending",
      "auth_created",
      "profile_created",
      "completed",
      "failed",
    ]) {
      expect(userRegistrationStatusLabel(status)).not.toBe(status);
    }
    expect(userRegistrationStatusLabel("unknown_internal_status")).toBe(
      "登録状態を確認してください",
    );
  });
});
