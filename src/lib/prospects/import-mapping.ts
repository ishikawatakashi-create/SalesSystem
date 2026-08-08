export const PROSPECT_CSV_FIELDS = [
  "companyName",
  "websiteUrl",
  "domain",
  "mainPhone",
  "postalCode",
  "prefecture",
  "city",
  "address",
  "industry",
  "employeeRange",
  "contactName",
  "contactDepartment",
  "contactTitle",
  "contactEmail",
  "contactPhone",
  "externalRecordId",
  "notes",
] as const;

export type ProspectCsvField = (typeof PROSPECT_CSV_FIELDS)[number];

export const PROSPECT_CSV_FIELD_LABELS: Record<ProspectCsvField, string> = {
  companyName: "会社名",
  websiteUrl: "Webサイト",
  domain: "ドメイン",
  mainPhone: "電話",
  postalCode: "郵便番号",
  prefecture: "都道府県",
  city: "市区町村",
  address: "住所",
  industry: "業種",
  employeeRange: "従業員規模",
  contactName: "担当者名",
  contactDepartment: "部署",
  contactTitle: "役職",
  contactEmail: "担当者メール",
  contactPhone: "担当者電話",
  externalRecordId: "外部レコードID",
  notes: "メモ",
};

const ALIASES: Record<ProspectCsvField, string[]> = {
  companyName: [
    "会社名",
    "企業名",
    "法人名",
    "名称",
    "company",
    "company_name",
    "companyname",
    "organization",
  ],
  websiteUrl: [
    "ウェブサイト",
    "webサイト",
    "Ｗｅｂサイト",
    "web",
    "website",
    "url",
    "ホームページ",
    "hp",
  ],
  domain: ["ドメイン", "domain"],
  mainPhone: ["電話", "電話番号", "tel", "phone", "代表電話"],
  postalCode: ["郵便番号", "郵便", "zip", "postal", "postal_code"],
  prefecture: ["都道府県", "prefecture"],
  city: ["市区町村", "市区", "city"],
  address: ["住所", "所在地", "address", "番地"],
  industry: ["業種", "業界", "industry", "カテゴリ"],
  employeeRange: ["従業員規模", "従業員数", "employees", "規模"],
  contactName: ["担当者名", "担当者", "氏名", "contact", "contact_name"],
  contactDepartment: ["部署", "department"],
  contactTitle: ["役職", "title", "肩書"],
  contactEmail: ["担当者メール", "メール", "email", "mail"],
  contactPhone: ["担当者電話", "携帯", "mobile", "contact_phone"],
  externalRecordId: [
    "外部レコードid",
    "外部id",
    "external_id",
    "record_id",
    "id",
  ],
  notes: ["メモ", "備考", "notes", "comment"],
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-　]/g, "");
}

export type ProspectColumnMapping = Partial<
  Record<ProspectCsvField, string | null>
>;

export function suggestProspectMapping(
  headers: string[],
): ProspectColumnMapping {
  const mapping: ProspectColumnMapping = {};
  const used = new Set<string>();
  const byNorm = new Map(headers.map((h) => [normHeader(h), h]));

  for (const field of PROSPECT_CSV_FIELDS) {
    for (const alias of ALIASES[field]) {
      const hit = byNorm.get(normHeader(alias));
      if (hit && !used.has(hit)) {
        mapping[field] = hit;
        used.add(hit);
        break;
      }
    }
  }
  return mapping;
}

export function unmappedHeaders(
  headers: string[],
  mapping: ProspectColumnMapping,
): string[] {
  const mapped = new Set(
    Object.values(mapping).filter((v): v is string => Boolean(v)),
  );
  return headers.filter((h) => !mapped.has(h));
}
