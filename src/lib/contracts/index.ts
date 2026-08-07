/**
 * 契約ドメイン公開面。
 */
export type {
  ContractWriteInput,
  ContractCreateCommand,
  ContractUpdateCommand,
  ContractWriteResult,
  ContractCreateResult,
  ContractUpdateResult,
  ContractIndexRow,
  ContractDetail,
  ContractListQuery,
  ContractRecoveryPayload,
  ContractStatusSemantic,
  ContractPaymentSemantic,
  WriteOperationRow,
} from "@/lib/contracts/types";

export {
  CONTRACT_ACTIVE_SEMANTIC,
  CONTRACT_STATUS_SEMANTICS,
  CONTRACT_PAYMENT_SEMANTICS,
  isContractActiveSemantic,
} from "@/lib/contracts/types";

export {
  hashContractWriteInput,
  sanitizeContractWriteInput,
  canonicalizeContractWriteInput,
} from "@/lib/contracts/input-hash";

export {
  hashContractDomain,
  hashContractWriteWithExternalId,
} from "@/lib/contracts/content-hash";

export {
  contractDomainToIndexRow,
  CONTRACT_INDEX_FIELD_MAP,
} from "@/lib/contracts/index-mapper";
