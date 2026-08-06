/**
 * 先方担当者(顧客担当者)ドメイン公開面。
 */
export type {
  ContactWriteInput,
  ContactCreateCommand,
  ContactUpdateCommand,
  ContactWriteResult,
  ContactIndexRow,
  ContactDetail,
  ContactListQuery,
  ContactRecoveryPayload,
  WriteOperationRow,
} from "@/lib/contacts/types";

export {
  hashContactWriteInput,
  sanitizeContactWriteInput,
  canonicalizeContactWriteInput,
} from "@/lib/contacts/input-hash";

export {
  hashContactDomain,
  hashContactWriteWithExternalId,
} from "@/lib/contacts/content-hash";

export {
  contactDomainToIndexRow,
  CONTACT_INDEX_FIELD_MAP,
} from "@/lib/contacts/index-mapper";
