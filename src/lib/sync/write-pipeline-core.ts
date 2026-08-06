import type { Client } from "@notionhq/client";

import {
  hashCustomerWriteInput,
  sanitizeCustomerWriteInput,
} from "@/lib/customers/input-hash";
import {
  hashCustomerDomain,
  hashCustomerWriteWithExternalId,
} from "@/lib/customers/content-hash";
import { customerDomainToIndexRow } from "@/lib/customers/index-mapper";
import type {
  CustomerCreateCommand,
  CustomerRecoveryPayload,
  CustomerUpdateCommand,
  CustomerWriteInput,
  CustomerWriteResult,
  WriteOperationRow,
} from "@/lib/customers/types";
import {
  customerToNotionProperties,
  notionPageToCustomer,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import {
  buildChangedFieldsAudit,
  buildCustomerPropertyDiff,
  omitDerivedCustomerProperties,
  writeInputToDomainFields,
} from "@/lib/sync/customer-diff";
import { CustomerSyncError } from "@/lib/sync/errors";

export type WriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: CustomerRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: CustomerRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type CustomerIndexStore = {
  upsert(row: ReturnType<typeof customerDomainToIndexRow>): Promise<void>;
  replaceRelations(input: {
    fromPageId: string;
    toPageIds: string[];
  }): Promise<void>;
  resolveStaffUserIds(staffPageIds: string[]): Promise<string[]>;
};

export type AuditStore = {
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

export type SyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type CustomerWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type CustomerWriteDeps = {
  notion: Client;
  customersDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: WriteOpStore;
  index: CustomerIndexStore;
  audit: AuditStore;
  syncErrors: SyncErrorStore;
  logger: CustomerWriteLogger;
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
  deps: CustomerWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.customersDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadCustomerPage(
  deps: CustomerWriteDeps,
  pageId: string,
) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const customer = await notionPageToCustomer({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, customer, lastEditedTime };
}

function buildRecoveryPayload(input: {
  write: CustomerWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  derived?: Parameters<typeof hashCustomerWriteWithExternalId>[0]["derived"];
  expectedLastEditedTime?: string;
}): CustomerRecoveryPayload {
  const domain = writeInputToDomainFields(
    input.externalId,
    input.write,
    input.derived,
  );
  return {
    expectedProperties: omitDerivedCustomerProperties(
      customerToNotionProperties({
        customer: domain,
        propertiesByName: input.propertiesByName,
      }),
      input.propertiesByName,
    ),
    expectedRelations: {
      businessCategoryPageIds: input.write.businessCategoryPageIds,
      tagPageIds: input.write.tagPageIds,
      salesStatusPageId: input.write.salesStatusPageId,
      acquisitionRoutePageId: input.write.acquisitionRoutePageId,
      priorityPageId: input.write.priorityPageId,
      staffPageIds: input.write.staffPageIds,
      relatedAccountPageIds: input.write.relatedAccountPageIds,
    },
    expectedContentHash: hashCustomerWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
      derived: input.derived,
    }),
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function finishAfterNotion(input: {
  deps: CustomerWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "customer.create" | "customer.update";
  notionPageId: string;
  externalId: string;
  write: CustomerWriteInput;
  changedFields: Record<string, unknown> | null;
}): Promise<CustomerWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "customer",
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
      entityType: "customer",
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
    const { customer, lastEditedTime } = await loadCustomerPage(
      deps,
      input.notionPageId,
    );
    const staffUserIds = await deps.index.resolveStaffUserIds(
      customer.staffPageIds,
    );
    const contentHash = hashCustomerDomain(customer);
    const row = customerDomainToIndexRow({
      customer,
      staffUserIds,
      contentHash,
      notionLastEditedAt: lastEditedTime || null,
      syncStatus: partial ? "error" : "synced",
      syncErrorMessage: partial ? "partial_failure_after_notion" : null,
    });
    await deps.index.upsert(row);
    await deps.index.replaceRelations({
      fromPageId: input.notionPageId,
      toPageIds: customer.relatedAccountPageIds,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "customer",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "customer_index更新に失敗しました",
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
  deps: CustomerWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: CustomerWriteInput;
  operation: "create" | "update";
}): Promise<CustomerWriteResult> {
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
    throw new CustomerSyncError(
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
        // 未作成なら呼び出し元の create/update 本体へ戻すため null 相当を返す
        return {
          status: "pending",
          requestId: op.request_id,
          externalId: op.external_id,
          notionPageId: null,
        };
      }
    } else {
      // update pending: recovery_payload と現在値を比較
      if (!op.notion_page_id) {
        throw new CustomerSyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { customer } = await loadCustomerPage(deps, op.notion_page_id);
      const currentHash = hashCustomerDomain(customer);
      const expected = op.recovery_payload?.expectedContentHash;
      if (expected && currentHash === expected) {
        notionPageId = op.notion_page_id;
        await deps.writeOps.markNotionDone({
          requestId: op.request_id,
          notionPageId,
        });
      } else if (expected && currentHash !== expected) {
        // 未反映 → 再適用は呼び出し側
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
      input.operation === "create" ? "customer.create" : "customer.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
  });
}

export async function executeCustomerCreate(
  deps: CustomerWriteDeps,
  command: CustomerCreateCommand,
): Promise<CustomerWriteResult> {
  const write = sanitizeCustomerWriteInput(command.input);
  const inputHash = hashCustomerWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new CustomerSyncError(
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
    // pendingかつ未作成 → 下記で作成続行(external_idは既存行のもの)
    return createNotionPage({
      deps,
      requestId: command.requestId,
      actorId: command.actorId,
      actorName: command.actorName,
      externalId: existing.external_id,
      write,
      alreadyInserted: true,
    });
  }

  const externalId = command.externalId ?? newRequestId();
  const recovery = buildRecoveryPayload({
    write,
    externalId,
    propertiesByName: deps.propertiesByName,
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
    alreadyInserted: true,
  });
}

async function createNotionPage(input: {
  deps: CustomerWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: CustomerWriteInput;
  alreadyInserted: boolean;
}): Promise<CustomerWriteResult> {
  const { deps } = input;

  // 曖昧失敗・再実行: 先に external_id 照合
  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    // 導出キャッシュ(見込み金額含む)はcreate時も送らない
    const properties = omitDerivedCustomerProperties(
      customerToNotionProperties({
        customer: writeInputToDomainFields(input.externalId, input.write),
        propertiesByName: deps.propertiesByName,
      }),
      deps.propertiesByName,
    );
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.customersDataSourceId,
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
          throw new CustomerSyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new CustomerSyncError(
          "notion_failed",
          "Notion顧客ページの作成に失敗しました",
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
    action: "customer.create",
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

export async function executeCustomerUpdate(
  deps: CustomerWriteDeps,
  command: CustomerUpdateCommand,
): Promise<CustomerWriteResult> {
  const write = sanitizeCustomerWriteInput(command.input);
  const inputHash = hashCustomerWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new CustomerSyncError(
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
      throw new CustomerSyncError(
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
        action: "customer.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    // pending: recovery_payload と現在値を比較し、反映済みなら後続、未反映なら再適用
    if (existing.notion_page_id) {
      const { customer } = await loadCustomerPage(
        deps,
        existing.notion_page_id,
      );
      const currentHash = hashCustomerDomain(customer);
      const expected = existing.recovery_payload?.expectedContentHash;
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
          action: "customer.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
        });
      }
      // 未反映 → 楽観ロックをスキップして再適用(下記)
    }
  }

  const { customer, lastEditedTime } = await loadCustomerPage(
    deps,
    command.notionPageId,
  );
  if (customer.inTrash) {
    throw new CustomerSyncError(
      "in_trash",
      "ゴミ箱内の顧客は更新できません",
    );
  }
  if (customer.externalId !== command.externalId) {
    throw new CustomerSyncError(
      "validation",
      "external_idが一致しません",
    );
  }

  // 初回のみ楽観ロック。resume(pending再適用)時はスキップ
  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new CustomerSyncError(
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
    derived: {
      latestActivitySummary: customer.latestActivitySummary,
      lastActivityAt: customer.lastActivityAt,
      nextAction: customer.nextAction,
      nextActionDate: customer.nextActionDate,
      expectedAmount: customer.expectedAmount,
    },
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

  const currentHash = hashCustomerDomain(customer);
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
      action: "customer.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
    });
  }

  const diff = buildCustomerPropertyDiff({
    before: customer,
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
        // 存在確認だけでは成功にしない。期待content_hashと照合する。
        const { customer: after } = await loadCustomerPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashCustomerDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
          // 反映済みとして後続へ進む
        } else {
          await deps.syncErrors.insert({
            stage: "ambiguous_update",
            entityType: "customer",
            notionPageId: command.notionPageId,
            externalId: command.externalId,
            message:
              "Notion更新結果が曖昧で期待content_hashと不一致。自動再更新しない",
            detail: {
              expected_hash_prefix: recovery.expectedContentHash.slice(0, 8),
              actual_hash_prefix: afterHash.slice(0, 8),
            },
          });
          deps.logger.error({
            request_id: command.requestId,
            message: "update_ambiguous_hash_mismatch",
          });
          throw new CustomerSyncError(
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
        throw new CustomerSyncError(
          "notion_failed",
          "Notion顧客ページの更新に失敗しました",
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
    action: "customer.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildChangedFieldsAudit({ before: customer, write }),
  });
}
