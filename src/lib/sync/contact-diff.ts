import type { ContactDomain } from "@/lib/notion/converters/contact";
import type { ContactWriteInput } from "@/lib/contacts/types";
import {
  contactToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/contact";

/**
 * 更新時に送る差分プロパティのみ抽出。
 * 先方担当者に導出キャッシュはないため全書込フィールドを対象にする。
 */
export function buildContactPropertyDiff(input: {
  before: ContactDomain;
  write: ContactWriteInput;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain: Omit<ContactDomain, "notionPageId" | "inTrash"> = {
    externalId: input.before.externalId,
    name: input.write.name,
    nameKana: input.write.nameKana,
    customerPageId: input.write.customerPageId,
    department: input.write.department,
    title: input.write.title,
    phone: input.write.phone,
    email: input.write.email,
    contactTypePageId: input.write.contactTypePageId,
    note: input.write.note,
    isActive: input.write.isActive,
  };

  const beforeProps = contactToNotionProperties({
    contact: {
      externalId: input.before.externalId,
      name: input.before.name,
      nameKana: input.before.nameKana,
      customerPageId: input.before.customerPageId,
      department: input.before.department,
      title: input.before.title,
      phone: input.before.phone,
      email: input.before.email,
      contactTypePageId: input.before.contactTypePageId,
      note: input.before.note,
      isActive: input.before.isActive,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = contactToNotionProperties({
    contact: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterProps)) {
    const before = beforeProps[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      diff[key] = value;
    }
  }
  return diff;
}

export function buildChangedFieldsAudit(input: {
  before: ContactDomain;
  write: ContactWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["氏名", input.before.name, input.write.name],
    ["氏名よみ", input.before.nameKana, input.write.nameKana],
    ["所属アカウント", input.before.customerPageId, input.write.customerPageId],
    ["部署", input.before.department, input.write.department],
    ["役職", input.before.title, input.write.title],
    ["電話番号", input.before.phone, input.write.phone],
    ["メールアドレス", input.before.email, input.write.email],
    ["区分", input.before.contactTypePageId, input.write.contactTypePageId],
    ["備考", input.before.note, input.write.note],
    ["有効", input.before.isActive, input.write.isActive],
  ];
  for (const [field, before, after] of pairs) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }
  return changed;
}

export function writeInputToDomainFields(
  externalId: string,
  write: ContactWriteInput,
): Omit<ContactDomain, "notionPageId" | "inTrash"> {
  return {
    externalId,
    name: write.name,
    nameKana: write.nameKana,
    customerPageId: write.customerPageId,
    department: write.department,
    title: write.title,
    phone: write.phone,
    email: write.email,
    contactTypePageId: write.contactTypePageId,
    note: write.note,
    isActive: write.isActive,
  };
}
