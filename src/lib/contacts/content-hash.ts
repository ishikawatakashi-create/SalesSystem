import { createHash } from "node:crypto";

import type { ContactDomain } from "@/lib/notion/converters/contact";
import type { ContactWriteInput } from "@/lib/contacts/types";

/**
 * 楽観ロック・復旧比較用の content_hash。
 */
export function hashContactDomain(
  contact: Omit<ContactDomain, "notionPageId" | "inTrash">,
): string {
  const payload = {
    externalId: contact.externalId,
    name: contact.name,
    nameKana: contact.nameKana,
    customerPageId: contact.customerPageId,
    department: contact.department,
    title: contact.title,
    phone: contact.phone,
    email: contact.email,
    contactTypePageId: contact.contactTypePageId,
    note: contact.note,
    isActive: contact.isActive,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

/** 書込入力+external_idから期待ハッシュを計算 */
export function hashContactWriteWithExternalId(input: {
  externalId: string;
  write: ContactWriteInput;
}): string {
  return hashContactDomain({
    externalId: input.externalId,
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
  });
}
