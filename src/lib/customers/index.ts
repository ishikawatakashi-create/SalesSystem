/**
 * 顧客ドメイン公開面。
 */
export type {
  CustomerWriteInput,
  CustomerCreateCommand,
  CustomerUpdateCommand,
  CustomerWriteResult,
  CustomerIndexRow,
  CustomerDetail,
  CustomerListQuery,
  CustomerRecoveryPayload,
  WriteOperationRow,
} from "@/lib/customers/types";

export {
  hashCustomerWriteInput,
  sanitizeCustomerWriteInput,
  canonicalizeCustomerWriteInput,
} from "@/lib/customers/input-hash";

export {
  hashCustomerDomain,
  hashCustomerWriteWithExternalId,
} from "@/lib/customers/content-hash";

export {
  customerDomainToIndexRow,
  CUSTOMER_INDEX_FIELD_MAP,
} from "@/lib/customers/index-mapper";
