/**
 * 案件ドメイン公開面。
 */
export type {
  DealWriteInput,
  DealCreateCommand,
  DealUpdateCommand,
  DealWriteResult,
  DealCreateResult,
  DealUpdateResult,
  DealIndexRow,
  DealDetail,
  DealListQuery,
  DealRecoveryPayload,
  WriteOperationRow,
} from "@/lib/deals/types";

export {
  hashDealWriteInput,
  sanitizeDealWriteInput,
  canonicalizeDealWriteInput,
} from "@/lib/deals/input-hash";

export {
  hashDealDomain,
  hashDealWriteWithExternalId,
} from "@/lib/deals/content-hash";

export {
  dealDomainToIndexRow,
  DEAL_INDEX_FIELD_MAP,
} from "@/lib/deals/index-mapper";

export {
  CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS,
  computeCustomerExpectedAmountFromDeals,
} from "@/lib/deals/expected-amount";
