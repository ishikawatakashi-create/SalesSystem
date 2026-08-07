/**
 * CSV テンプレート生成（インポート用サンプルファイル）。
 */
import type { ImportEntity } from "./entities";
import { getEntityFields } from "./mapping";

export type CsvTemplate = {
  filename: string;
  csv: string;
  fieldsHelp: FieldHelp[];
};

export type FieldHelp = {
  key: string;
  label: string;
  required: boolean;
  example: string;
  notes?: string;
};

export function getCsvTemplate(entity: ImportEntity): CsvTemplate {
  const fields = getEntityFields(entity).filter(
    (f) => f.kind !== "unsupported",
  );

  const headers = fields.map((f) => f.labelJa);
  const sampleRow = fields.map((f) => getSampleValue(entity, f.key));
  const fieldsHelp: FieldHelp[] = fields.map((f) => ({
    key: f.key,
    label: f.labelJa,
    required: f.required,
    example: getSampleValue(entity, f.key),
    notes: f.notes,
  }));

  const csvLines = [
    headers.map(escapeCsvCell).join(","),
    sampleRow.map(escapeCsvCell).join(","),
  ];

  return {
    filename: `${entity}_template.csv`,
    csv: `${csvLines.join("\r\n")}\r\n`,
    fieldsHelp,
  };
}

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getSampleValue(entity: ImportEntity, fieldKey: string): string {
  const common: Record<string, string> = {
    sourceRecordId: "SRC-001",
    displayName: "株式会社サンプル",
    legalName: "株式会社サンプル",
    officeName: "本社",
    postalCode: "100-0001",
    prefecture: "東京都",
    city: "千代田区",
    addressLine: "千代田1-1",
    phone: "03-1234-5678",
    email: "info@example.com",
    representativeName: "山田太郎",
    website: "https://example.com",
    businessCategoryNames: "IT",
    tagNames: "重要",
    salesStatusName: "見込み",
    acquisitionRouteName: "紹介",
    priorityName: "高",
    isArchived: "false",
    name: "佐藤花子",
    nameKana: "サトウハナコ",
    customerSourceKey: "SRC-001",
    department: "営業部",
    title: "部長",
    contactTypeName: "決裁者",
    note: "架空備考",
    isActive: "true",
    dealSourceKey: "DEAL-001",
    contactSourceKeys: "CONTACT-001",
    productName: "サンプル商材",
    stageName: "提案",
    statusName: "進行中",
    expectedAmount: "1000000",
    contractAmount: "0",
    probability: "50",
    expectedCloseDate: "2026-12-31",
    contractedAt: "2026-01-15",
    periodStart: "2026-02-01",
    periodEnd: "2027-01-31",
    lostReason: "",
    activityAt: "2026-08-01T10:00:00+09:00",
    categoryNames: "電話",
    summary: "架空の要約",
    body: "架空の対応内容本文",
    nextActionNote: "",
    nextActionDate: "",
    dueDate: "2026-08-15",
    completedAt: "",
    amount: "500000",
    startDate: "2026-02-01",
    endDate: "2027-01-31",
    autoRenew: "true",
    billingTerms: "月末締め翌月末払い",
    contractUrl: "https://example.com/contract",
    contractTypeName: "年間",
    tradeTypeName: "受注",
    paymentStatusName: "未請求",
    severityName: "中",
    occurredOn: "2026-07-01",
    completedOn: "",
    content: "架空の内容",
    cause: "架空の原因",
    response: "架空の対応",
    prevention: "架空の再発防止",
  };

  if (entity === "deals" && fieldKey === "title") return "test_sample_deal";
  if (entity === "activities" && fieldKey === "title") return "test_sample_activity";
  if (entity === "actions" && fieldKey === "title") return "test_sample_action";
  if (entity === "contracts" && fieldKey === "title") return "test_sample_contract";
  if (entity === "complaints" && fieldKey === "title") return "test_sample_complaint";
  return common[fieldKey] ?? "";
}
