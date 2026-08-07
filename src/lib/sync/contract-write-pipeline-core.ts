import type { Client } from "@notionhq/client";

import {
  hashContractWriteInput,
  sanitizeContractWriteInput,
} from "@/lib/contracts/input-hash";
import {
  hashContractDomain,
  hashContractWriteWithExternalId,
} from "@/lib/contracts/content-hash";
import { contractDomainToIndexRow } from "@/lib/contracts/index-mapper";
import type {
  ContractCreateCommand,
  ContractRecoveryPayload,
  ContractUpdateCommand,
  ContractWriteInput,
  ContractWriteResult,
  WriteOperationRow,
} from "@/lib/contracts/types";
import {
  contractToNotionProperties,
  notionPageToContract,
  type PropertyIdMap,
} from "@/lib/notion/converters/contract";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import {
  buildContractChangedFieldsAudit,
  buildContractPropertyDiff,
  writeInputToContractDomainFields,
} from "@/lib/sync/contract-diff";
import { ContractSyncError } from "@/lib/sync/errors";

export type ContractWriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: ContractRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: ContractRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type ContractIndexStore = {
  upsert(row: ReturnType<typeof contractDomainToIndexRow>): Promise<void>;
  resolveStaffUserIds(staffPageIds: string[]): Promise<string[]>;
  resolveStatusSemantic(statusPageId: string | null): Promise<string | null>;
  getCustomerDisplayName(customerPageId: string): Promise<string | null>;
  getDealTitle(dealPageId: string): Promise<string | null>;
  getStaffNames(staffPageIds: string[]): Promise<string[]>;
};

export type ContractAuditStore = {
  insert(input: {
    actorId: string;
    actorName: string;
    action: string;
    entityType: string;
    notionPageId: string;
    changedFields: Record<string, unknown> | null;
    operationSource: string;
    requestId: string;
  }): Promise<void>;
};

export type ContractSyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type ContractWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type ContractWriteDeps = {
  notion: Client;
  contractsDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: ContractWriteOpStore;
  index: ContractIndexStore;
  audit: ContractAuditStore;
  syncErrors: ContractSyncErrorStore;
  logger: ContractWriteLogger;
  pager?: PagePropertyPager;
};

function defaultPager(notion: Client): PagePropertyPager {
  return {
    retrieve: async ({ page_id, property_id, start_cursor }) => {
      const res = await notion.pages.properties.retrieve({
        page_id,
        property_id,
        start_cursor,
      } as never);
      return res as never;
    },
  };
}

async function findPageByExternalId(
  deps: ContractWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.contractsDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadContractPage(deps: ContractWriteDeps, pageId: string) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const contract = await notionPageToContract({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, contract, lastEditedTime };
}

function buildRecoveryPayload(input: {
  write: ContractWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  hasContractFile?: boolean;
  expectedLastEditedTime?: string;
}): ContractRecoveryPayload {
  const domain = writeInputToContractDomainFields(
    input.externalId,
    input.write,
    input.hasContractFile ?? false,
  );
  return {
    expectedProperties: contractToNotionProperties({
      contract: domain,
      propertiesByName: input.propertiesByName,
    }),
    expectedRelations: {
      customerPageId: input.write.customerPageId,
      dealPageId: input.write.dealPageId,
      contractTypePageId: input.write.contractTypePageId,
      tradeTypePageId: input.write.tradeTypePageId,
      paymentStatusPageId: input.write.paymentStatusPageId,
      statusPageId: input.write.statusPageId,
      staffPageIds: input.write.staffPageIds,
    },
    expectedContentHash: hashContractWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
      hasContractFile: input.hasContractFile ?? false,
    }),
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function upsertContractIndex(input: {
  deps: ContractWriteDeps;
  contract: Awaited<ReturnType<typeof loadContractPage>>["contract"];
  lastEditedTime: string;
  partial: boolean;
}): Promise<void> {
  const { deps, contract } = input;
  const contentHash = hashContractDomain(contract);
  const [staffUserIds, statusSemantic, customerDisplayName, dealTitle, staffNames] =
    await Promise.all([
      deps.index.resolveStaffUserIds(contract.staffPageIds),
      deps.index.resolveStatusSemantic(contract.statusPageId),
      contract.customerPageId
        ? deps.index.getCustomerDisplayName(contract.customerPageId)
        : Promise.resolve(null),
      contract.dealPageId
        ? deps.index.getDealTitle(contract.dealPageId)
        : Promise.resolve(null),
      deps.index.getStaffNames(contract.staffPageIds),
    ]);
  const row = contractDomainToIndexRow({
    contract,
    staffUserIds,
    statusSemantic,
    contentHash,
    notionLastEditedAt: input.lastEditedTime || null,
    syncStatus: input.partial ? "error" : "synced",
    syncErrorMessage: input.partial ? "partial_failure_after_notion" : null,
    customerDisplayName,
    dealTitle,
    staffNames,
  });
  await deps.index.upsert(row);
}

async function finishAfterNotion(input: {
  deps: ContractWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "contract.create" | "contract.update";
  notionPageId: string;
  externalId: string;
  write: ContractWriteInput;
  changedFields: Record<string, unknown> | null;
}): Promise<ContractWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "contract",
      notionPageId: input.notionPageId,
      changedFields: input.changedFields,
      operationSource: "app",
      requestId: input.requestId,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "audit_write",
      entityType: "contract",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "audit_logsへの記録に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
    deps.logger.error({
      request_id: input.requestId,
      message: "audit_write_failed",
    });
  }

  try {
    const { contract, lastEditedTime } = await loadContractPage(
      deps,
      input.notionPageId,
    );
    await upsertContractIndex({
      deps,
      contract,
      lastEditedTime,
      partial,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "contract",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "contract_index更新に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
    deps.logger.error({
      request_id: input.requestId,
      message: "index_update_failed",
    });
  }

  if (!partial) {
    await deps.writeOps.markCompleted(input.requestId);
    return {
      status: "completed",
      requestId: input.requestId,
      externalId: input.externalId,
      notionPageId: input.notionPageId,
    };
  }

  return {
    status: "notion_done",
    requestId: input.requestId,
    externalId: input.externalId,
    notionPageId: input.notionPageId,
    partialFailure: true,
    warning,
  };
}

async function resumeExisting(input: {
  deps: ContractWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: ContractWriteInput;
  operation: "create" | "update";
}): Promise<ContractWriteResult> {
  const { deps, op } = input;
  if (op.status === "completed") {
    return {
      status: "completed",
      requestId: op.request_id,
      externalId: op.external_id,
      notionPageId: op.notion_page_id,
    };
  }
  if (op.status === "failed") {
    throw new ContractSyncError(
      "forbidden_state",
      "失敗済みのrequest_idは再利用できません",
    );
  }

  let notionPageId = op.notion_page_id;
  if (op.status === "pending") {
    if (input.operation === "create") {
      const existing = await findPageByExternalId(deps, op.external_id);
      if (existing) {
        notionPageId = existing.id;
        await deps.writeOps.markNotionDone({
          requestId: op.request_id,
          notionPageId: existing.id,
        });
      } else {
        return {
          status: "pending",
          requestId: op.request_id,
          externalId: op.external_id,
          notionPageId: null,
        };
      }
    } else {
      if (!op.notion_page_id) {
        throw new ContractSyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { contract } = await loadContractPage(deps, op.notion_page_id);
      const currentHash = hashContractDomain(contract);
      const expected = (
        op.recovery_payload as ContractRecoveryPayload | null
      )?.expectedContentHash;
      if (expected && currentHash === expected) {
        notionPageId = op.notion_page_id;
        await deps.writeOps.markNotionDone({
          requestId: op.request_id,
          notionPageId,
        });
      } else if (expected && currentHash !== expected) {
        return {
          status: "pending",
          requestId: op.request_id,
          externalId: op.external_id,
          notionPageId: op.notion_page_id,
        };
      } else {
        notionPageId = op.notion_page_id;
      }
    }
  }

  if (!notionPageId) {
    return {
      status: "pending",
      requestId: op.request_id,
      externalId: op.external_id,
      notionPageId: null,
    };
  }

  return finishAfterNotion({
    deps,
    requestId: op.request_id,
    actorId: input.actorId,
    actorName: input.actorName,
    action:
      input.operation === "create" ? "contract.create" : "contract.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
  });
}

export async function executeContractCreate(
  deps: ContractWriteDeps,
  command: ContractCreateCommand,
): Promise<ContractWriteResult> {
  const write = sanitizeContractWriteInput(command.input);
  const inputHash = hashContractWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ContractSyncError(
        "input_hash_mismatch",
        "同じrequest_idに異なる入力は拒否されます",
      );
    }
    const resumed = await resumeExisting({
      deps,
      op: existing,
      actorId: command.actorId,
      actorName: command.actorName,
      write,
      operation: "create",
    });
    if (resumed.status !== "pending" || resumed.notionPageId) {
      return resumed;
    }
    return createNotionPage({
      deps,
      requestId: command.requestId,
      actorId: command.actorId,
      actorName: command.actorName,
      externalId: existing.external_id,
      write,
    });
  }

  const externalId = command.externalId ?? newRequestId();
  const recovery = buildRecoveryPayload({
    write,
    externalId,
    propertiesByName: deps.propertiesByName,
    hasContractFile: false,
  });

  await deps.writeOps.insertPending({
    requestId: command.requestId,
    operation: "create",
    externalId,
    inputHash,
    actorId: command.actorId,
    recoveryPayload: recovery,
  });

  return createNotionPage({
    deps,
    requestId: command.requestId,
    actorId: command.actorId,
    actorName: command.actorName,
    externalId,
    write,
  });
}

async function createNotionPage(input: {
  deps: ContractWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: ContractWriteInput;
}): Promise<ContractWriteResult> {
  const { deps } = input;

  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    const properties = contractToNotionProperties({
      contract: writeInputToContractDomainFields(
        input.externalId,
        input.write,
        false,
      ),
      propertiesByName: deps.propertiesByName,
    });
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.contractsDataSourceId,
        },
        properties,
      } as never);
      notionPageId = (created as { id: string }).id;
    } catch (error) {
      if (
        error instanceof NotionHttpError &&
        (error.code === "write_ambiguous_failure" || error.status >= 500)
      ) {
        deps.logger.warn({
          request_id: input.requestId,
          message: "create_ambiguous_recover_by_external_id",
        });
        const recovered = await findPageByExternalId(deps, input.externalId);
        if (recovered) {
          notionPageId = recovered.id;
        } else {
          await deps.writeOps.markFailed(
            input.requestId,
            "notion_create_ambiguous_failure",
          );
          throw new ContractSyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new ContractSyncError(
          "notion_failed",
          "Notion契約ページの作成に失敗しました",
        );
      }
    }
  }

  await deps.writeOps.markNotionDone({
    requestId: input.requestId,
    notionPageId,
  });

  return finishAfterNotion({
    deps,
    requestId: input.requestId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "contract.create",
    notionPageId,
    externalId: input.externalId,
    write: input.write,
    changedFields: Object.fromEntries(
      Object.entries(input.write).map(([k, v]) => [
        k,
        { before: null, after: v },
      ]),
    ),
  });
}

export async function executeContractUpdate(
  deps: ContractWriteDeps,
  command: ContractUpdateCommand,
): Promise<ContractWriteResult> {
  const write = sanitizeContractWriteInput(command.input);
  const inputHash = hashContractWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ContractSyncError(
        "input_hash_mismatch",
        "同じrequest_idに異なる入力は拒否されます",
      );
    }
    if (existing.status === "completed") {
      return {
        status: "completed",
        requestId: existing.request_id,
        externalId: existing.external_id,
        notionPageId: existing.notion_page_id,
      };
    }
    if (existing.status === "failed") {
      throw new ContractSyncError(
        "forbidden_state",
        "失敗済みのrequest_idは再利用できません",
      );
    }
    if (existing.status === "notion_done" && existing.notion_page_id) {
      return finishAfterNotion({
        deps,
        requestId: existing.request_id,
        actorId: command.actorId,
        actorName: command.actorName,
        action: "contract.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    if (existing.notion_page_id) {
      const { contract } = await loadContractPage(
        deps,
        existing.notion_page_id,
      );
      const currentHash = hashContractDomain(contract);
      const expected = (
        existing.recovery_payload as ContractRecoveryPayload | null
      )?.expectedContentHash;
      if (expected && currentHash === expected) {
        await deps.writeOps.markNotionDone({
          requestId: existing.request_id,
          notionPageId: existing.notion_page_id,
        });
        return finishAfterNotion({
          deps,
          requestId: existing.request_id,
          actorId: command.actorId,
          actorName: command.actorName,
          action: "contract.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
        });
      }
    }
  }

  const { contract, lastEditedTime } = await loadContractPage(
    deps,
    command.notionPageId,
  );
  if (contract.inTrash) {
    throw new ContractSyncError(
      "in_trash",
      "ゴミ箱内の契約は更新できません",
    );
  }
  if (contract.externalId !== command.externalId) {
    throw new ContractSyncError("validation", "external_idが一致しません");
  }

  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new ContractSyncError(
      "conflict",
      "他の変更があります。再読込してから保存してください",
      {
        expectedLastEditedTime: command.expectedLastEditedTime,
        actualLastEditedTime: lastEditedTime,
      },
    );
  }

  const recovery = buildRecoveryPayload({
    write,
    externalId: command.externalId,
    propertiesByName: deps.propertiesByName,
    hasContractFile: contract.hasContractFile,
    expectedLastEditedTime: command.expectedLastEditedTime,
  });

  if (!existing) {
    await deps.writeOps.insertPending({
      requestId: command.requestId,
      operation: "update",
      externalId: command.externalId,
      inputHash,
      actorId: command.actorId,
      recoveryPayload: recovery,
      notionPageId: command.notionPageId,
    });
  }

  const currentHash = hashContractDomain(contract);
  if (currentHash === recovery.expectedContentHash) {
    await deps.writeOps.markNotionDone({
      requestId: command.requestId,
      notionPageId: command.notionPageId,
      recoveryPayload: recovery,
    });
    return finishAfterNotion({
      deps,
      requestId: command.requestId,
      actorId: command.actorId,
      actorName: command.actorName,
      action: "contract.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
    });
  }

  const diff = buildContractPropertyDiff({
    before: contract,
    write,
    propertiesByName: deps.propertiesByName,
  });

  if (Object.keys(diff).length > 0) {
    try {
      await deps.notion.pages.update({
        page_id: command.notionPageId,
        properties: diff,
      } as never);
    } catch (error) {
      if (
        error instanceof NotionHttpError &&
        (error.code === "write_ambiguous_failure" || error.status >= 500)
      ) {
        const { contract: after } = await loadContractPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashContractDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
        } else {
          await deps.syncErrors.insert({
            stage: "ambiguous_update",
            entityType: "contract",
            notionPageId: command.notionPageId,
            externalId: command.externalId,
            message:
              "Notion更新結果が曖昧で期待content_hashと不一致。自動再更新しない",
            detail: {
              expected_hash_prefix: recovery.expectedContentHash.slice(0, 8),
              actual_hash_prefix: afterHash.slice(0, 8),
            },
          });
          throw new ContractSyncError(
            "ambiguous_write",
            "Notion更新結果を判定できませんでした。管理者による確認が必要です",
            { stage: "ambiguous_update" },
          );
        }
      } else {
        await deps.writeOps.markFailed(
          command.requestId,
          error instanceof Error ? error.message : "notion_update_failed",
        );
        throw new ContractSyncError(
          "notion_failed",
          "Notion契約ページの更新に失敗しました",
        );
      }
    }
  }

  await deps.writeOps.markNotionDone({
    requestId: command.requestId,
    notionPageId: command.notionPageId,
    recoveryPayload: recovery,
  });

  return finishAfterNotion({
    deps,
    requestId: command.requestId,
    actorId: command.actorId,
    actorName: command.actorName,
    action: "contract.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildContractChangedFieldsAudit({
      before: contract,
      write,
    }),
  });
}
