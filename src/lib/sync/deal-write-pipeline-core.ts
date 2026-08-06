import type { Client } from "@notionhq/client";

import {
  hashDealWriteInput,
  sanitizeDealWriteInput,
} from "@/lib/deals/input-hash";
import {
  hashDealDomain,
  hashDealWriteWithExternalId,
} from "@/lib/deals/content-hash";
import { dealDomainToIndexRow } from "@/lib/deals/index-mapper";
import type {
  DealCreateCommand,
  DealRecoveryPayload,
  DealUpdateCommand,
  DealWriteInput,
  DealWriteResult,
  WriteOperationRow,
} from "@/lib/deals/types";
import {
  dealToNotionProperties,
  notionPageToDeal,
  type PropertyIdMap,
} from "@/lib/notion/converters/deal";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import {
  buildChangedFieldsAudit,
  buildDealPropertyDiff,
  omitDerivedDealProperties,
  writeInputToDomainFields,
} from "@/lib/sync/deal-diff";
import { DealSyncError } from "@/lib/sync/errors";

export type DealWriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: DealRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: DealRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type DealIndexStore = {
  upsert(row: ReturnType<typeof dealDomainToIndexRow>): Promise<void>;
  resolveStaffUserIds(staffPageIds: string[]): Promise<string[]>;
  resolveStatusSemantic(statusPageId: string | null): Promise<string | null>;
  getCustomerDisplayName(customerPageId: string): Promise<string | null>;
  getContactNames(contactPageIds: string[]): Promise<string[]>;
  getStaffNames(staffPageIds: string[]): Promise<string[]>;
};

export type DealAuditStore = {
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

export type DealSyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type DealExpectedAmountRecalc = {
  requestForCustomers(input: {
    customerPageIds: Array<string | null | undefined>;
    sourceDealExternalId?: string;
  }): Promise<void>;
};

export type DealWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type DealWriteDeps = {
  notion: Client;
  dealsDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: DealWriteOpStore;
  index: DealIndexStore;
  audit: DealAuditStore;
  syncErrors: DealSyncErrorStore;
  expectedAmountRecalc: DealExpectedAmountRecalc;
  logger: DealWriteLogger;
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
  deps: DealWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.dealsDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadDealPage(deps: DealWriteDeps, pageId: string) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const deal = await notionPageToDeal({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, deal, lastEditedTime };
}

function buildRecoveryPayload(input: {
  write: DealWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  expectedLastEditedTime?: string;
  derived?: { nextAction: string | null; nextActionDate: string | null };
}): DealRecoveryPayload {
  const domain = writeInputToDomainFields(
    input.externalId,
    input.write,
    input.derived,
  );
  return {
    expectedProperties: omitDerivedDealProperties(
      dealToNotionProperties({
        deal: domain,
        propertiesByName: input.propertiesByName,
      }),
      input.propertiesByName,
    ),
    expectedRelations: {
      customerPageId: input.write.customerPageId,
      contactPageIds: input.write.contactPageIds,
      businessCategoryPageId: input.write.businessCategoryPageId,
      stagePageId: input.write.stagePageId,
      staffPageIds: input.write.staffPageIds,
      statusPageId: input.write.statusPageId,
    },
    expectedContentHash: hashDealWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
      derived: input.derived,
    }),
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function upsertDealIndex(input: {
  deps: DealWriteDeps;
  deal: Awaited<ReturnType<typeof loadDealPage>>["deal"];
  lastEditedTime: string;
  partial: boolean;
}): Promise<void> {
  const { deps, deal } = input;
  const contentHash = hashDealDomain(deal);
  const [staffUserIds, statusSemantic, customerDisplayName, contactNames, staffNames] =
    await Promise.all([
      deps.index.resolveStaffUserIds(deal.staffPageIds),
      deps.index.resolveStatusSemantic(deal.statusPageId),
      deal.customerPageId
        ? deps.index.getCustomerDisplayName(deal.customerPageId)
        : Promise.resolve(null),
      deps.index.getContactNames(deal.contactPageIds),
      deps.index.getStaffNames(deal.staffPageIds),
    ]);
  const row = dealDomainToIndexRow({
    deal,
    staffUserIds,
    statusSemantic,
    contentHash,
    notionLastEditedAt: input.lastEditedTime || null,
    syncStatus: input.partial ? "error" : "synced",
    syncErrorMessage: input.partial ? "partial_failure_after_notion" : null,
    customerDisplayName,
    contactNames,
    staffNames,
  });
  await deps.index.upsert(row);
}

async function requestRecalcBestEffort(input: {
  deps: DealWriteDeps;
  requestId: string;
  customerPageIds: Array<string | null | undefined>;
  notionPageId: string;
  externalId: string;
}): Promise<{ partial: boolean; warning?: string }> {
  try {
    await input.deps.expectedAmountRecalc.requestForCustomers({
      customerPageIds: input.customerPageIds,
      sourceDealExternalId: input.externalId,
    });
    return { partial: false };
  } catch (error) {
    await input.deps.syncErrors.insert({
      stage: "expected_amount_recalc",
      entityType: "deal",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "顧客見込み金額の再計算要求に失敗しました",
      detail: {
        error: error instanceof Error ? error.message : "unknown",
      },
    });
    input.deps.logger.error({
      request_id: input.requestId,
      message: "expected_amount_recalc_failed",
    });
    return {
      partial: true,
      warning:
        "保存は完了しましたが、顧客の見込み金額反映が遅れる可能性があります",
    };
  }
}

async function finishAfterNotion(input: {
  deps: DealWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "deal.create" | "deal.update";
  notionPageId: string;
  externalId: string;
  write: DealWriteInput;
  changedFields: Record<string, unknown> | null;
  previousCustomerPageId?: string | null;
}): Promise<DealWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "deal",
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
      entityType: "deal",
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

  let dealCustomerPageId: string | null = input.write.customerPageId;
  try {
    const { deal, lastEditedTime } = await loadDealPage(
      deps,
      input.notionPageId,
    );
    dealCustomerPageId = deal.customerPageId;
    await upsertDealIndex({
      deps,
      deal,
      lastEditedTime,
      partial,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "deal",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "deal_index更新に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
    deps.logger.error({
      request_id: input.requestId,
      message: "index_update_failed",
    });
  }

  const recalc = await requestRecalcBestEffort({
    deps,
    requestId: input.requestId,
    customerPageIds: [dealCustomerPageId, input.previousCustomerPageId],
    notionPageId: input.notionPageId,
    externalId: input.externalId,
  });
  if (recalc.partial) {
    partial = true;
    warning = recalc.warning ?? warning;
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
  deps: DealWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: DealWriteInput;
  operation: "create" | "update";
  previousCustomerPageId?: string | null;
}): Promise<DealWriteResult> {
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
    throw new DealSyncError(
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
        throw new DealSyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { deal } = await loadDealPage(deps, op.notion_page_id);
      const currentHash = hashDealDomain(deal);
      const expected = (
        op.recovery_payload as DealRecoveryPayload | null
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
    action: input.operation === "create" ? "deal.create" : "deal.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
    previousCustomerPageId: input.previousCustomerPageId,
  });
}

export async function executeDealCreate(
  deps: DealWriteDeps,
  command: DealCreateCommand,
): Promise<DealWriteResult> {
  const write = sanitizeDealWriteInput(command.input);
  const inputHash = hashDealWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new DealSyncError(
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
  deps: DealWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: DealWriteInput;
}): Promise<DealWriteResult> {
  const { deps } = input;

  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    const properties = omitDerivedDealProperties(
      dealToNotionProperties({
        deal: writeInputToDomainFields(input.externalId, input.write),
        propertiesByName: deps.propertiesByName,
      }),
      deps.propertiesByName,
    );
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.dealsDataSourceId,
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
          throw new DealSyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new DealSyncError(
          "notion_failed",
          "Notion案件ページの作成に失敗しました",
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
    action: "deal.create",
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

export async function executeDealUpdate(
  deps: DealWriteDeps,
  command: DealUpdateCommand,
): Promise<DealWriteResult> {
  const write = sanitizeDealWriteInput(command.input);
  const inputHash = hashDealWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new DealSyncError(
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
      throw new DealSyncError(
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
        action: "deal.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    if (existing.notion_page_id) {
      const { deal } = await loadDealPage(deps, existing.notion_page_id);
      const currentHash = hashDealDomain(deal);
      const expected = (
        existing.recovery_payload as DealRecoveryPayload | null
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
          action: "deal.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
          previousCustomerPageId: deal.customerPageId,
        });
      }
    }
  }

  const { deal, lastEditedTime } = await loadDealPage(
    deps,
    command.notionPageId,
  );
  if (deal.inTrash) {
    throw new DealSyncError("in_trash", "ゴミ箱内の案件は更新できません");
  }
  if (deal.externalId !== command.externalId) {
    throw new DealSyncError("validation", "external_idが一致しません");
  }

  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new DealSyncError(
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
    expectedLastEditedTime: command.expectedLastEditedTime,
    derived: {
      nextAction: deal.nextAction,
      nextActionDate: deal.nextActionDate,
    },
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

  const currentHash = hashDealDomain(deal);
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
      action: "deal.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
      previousCustomerPageId: deal.customerPageId,
    });
  }

  const diff = buildDealPropertyDiff({
    before: deal,
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
        const { deal: after } = await loadDealPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashDealDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
        } else {
          await deps.syncErrors.insert({
            stage: "ambiguous_update",
            entityType: "deal",
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
          throw new DealSyncError(
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
        throw new DealSyncError(
          "notion_failed",
          "Notion案件ページの更新に失敗しました",
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
    action: "deal.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildChangedFieldsAudit({ before: deal, write }),
    previousCustomerPageId: deal.customerPageId,
  });
}
