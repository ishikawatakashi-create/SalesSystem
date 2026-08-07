import type { Client } from "@notionhq/client";

import {
  hashActionWriteInput,
  sanitizeActionWriteInput,
} from "@/lib/actions/input-hash";
import {
  hashActionDomain,
  hashActionWriteWithExternalId,
} from "@/lib/actions/content-hash";
import { actionDomainToIndexRow } from "@/lib/actions/index-mapper";
import {
  isActionDoneSemantic,
  type ActionCreateCommand,
  type ActionRecoveryPayload,
  type ActionUpdateCommand,
  type ActionWriteInput,
  type ActionWriteResult,
  type WriteOperationRow,
} from "@/lib/actions/types";
import {
  actionToNotionProperties,
  notionPageToAction,
  type PropertyIdMap,
} from "@/lib/notion/converters/action";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import { todayDateTokyo } from "@/lib/normalize";
import {
  buildActionChangedFieldsAudit,
  buildActionPropertyDiff,
  writeInputToActionDomainFields,
} from "@/lib/sync/action-diff";
import { ActionSyncError } from "@/lib/sync/errors";

export type ActionWriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: ActionRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: ActionRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type ActionIndexStore = {
  upsert(row: ReturnType<typeof actionDomainToIndexRow>): Promise<void>;
  resolveAssigneeUserId(staffPageId: string | null): Promise<string | null>;
  resolveStatusSemantic(statusPageId: string | null): Promise<string | null>;
  getCustomerDisplayName(customerPageId: string): Promise<string | null>;
  getDealTitle(dealPageId: string): Promise<string | null>;
  getStaffName(staffPageId: string): Promise<string | null>;
};

export type ActionAuditStore = {
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

export type ActionSyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type ActionNextRecalc = {
  requestForTargets(input: {
    customerPageIds: Array<string | null | undefined>;
    dealPageIds: Array<string | null | undefined>;
    sourceActionExternalId?: string;
  }): Promise<void>;
};

export type ActionWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type ActionWriteDeps = {
  notion: Client;
  actionsDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: ActionWriteOpStore;
  index: ActionIndexStore;
  audit: ActionAuditStore;
  syncErrors: ActionSyncErrorStore;
  nextActionRecalc: ActionNextRecalc;
  logger: ActionWriteLogger;
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
  deps: ActionWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.actionsDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadActionPage(deps: ActionWriteDeps, pageId: string) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const action = await notionPageToAction({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, action, lastEditedTime };
}

/**
 * 状態が done で完了日時が空なら Asia/Tokyo の今日(YYYY-MM-DD)を埋める。
 */
async function applyCompletedAtPolicy(
  deps: ActionWriteDeps,
  write: ActionWriteInput,
): Promise<ActionWriteInput> {
  const semantic = await deps.index.resolveStatusSemantic(write.statusPageId);
  if (isActionDoneSemantic(semantic) && !write.completedAt) {
    return { ...write, completedAt: todayDateTokyo() };
  }
  return write;
}

function buildRecoveryPayload(input: {
  write: ActionWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  createdById: string | null;
  createdByName: string | null;
  expectedLastEditedTime?: string;
}): ActionRecoveryPayload {
  const domain = writeInputToActionDomainFields({
    externalId: input.externalId,
    write: input.write,
    createdById: input.createdById,
    createdByName: input.createdByName,
  });
  return {
    expectedProperties: actionToNotionProperties({
      action: domain,
      propertiesByName: input.propertiesByName,
    }),
    expectedRelations: {
      customerPageId: input.write.customerPageId,
      dealPageId: input.write.dealPageId,
      activityPageId: input.write.activityPageId,
      staffPageId: input.write.staffPageId,
      statusPageId: input.write.statusPageId,
      priorityPageId: input.write.priorityPageId,
    },
    expectedContentHash: hashActionWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
      createdById: input.createdById,
      createdByName: input.createdByName,
    }),
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function upsertActionIndex(input: {
  deps: ActionWriteDeps;
  action: Awaited<ReturnType<typeof loadActionPage>>["action"];
  lastEditedTime: string;
  partial: boolean;
}): Promise<void> {
  const { deps, action } = input;
  const contentHash = hashActionDomain(action);
  const [assigneeUserId, statusSemantic, customerDisplayName, dealTitle, staffName] =
    await Promise.all([
      deps.index.resolveAssigneeUserId(action.staffPageId),
      deps.index.resolveStatusSemantic(action.statusPageId),
      action.customerPageId
        ? deps.index.getCustomerDisplayName(action.customerPageId)
        : Promise.resolve(null),
      action.dealPageId
        ? deps.index.getDealTitle(action.dealPageId)
        : Promise.resolve(null),
      action.staffPageId
        ? deps.index.getStaffName(action.staffPageId)
        : Promise.resolve(null),
    ]);
  const row = actionDomainToIndexRow({
    action,
    assigneeUserId,
    statusSemantic,
    contentHash,
    notionLastEditedAt: input.lastEditedTime || null,
    syncStatus: input.partial ? "error" : "synced",
    syncErrorMessage: input.partial ? "partial_failure_after_notion" : null,
    customerDisplayName,
    dealTitle,
    staffName,
  });
  await deps.index.upsert(row);
}

async function requestRecalcBestEffort(input: {
  deps: ActionWriteDeps;
  requestId: string;
  customerPageIds: Array<string | null | undefined>;
  dealPageIds: Array<string | null | undefined>;
  notionPageId: string;
  externalId: string;
}): Promise<{ partial: boolean; warning?: string }> {
  try {
    await input.deps.nextActionRecalc.requestForTargets({
      customerPageIds: input.customerPageIds,
      dealPageIds: input.dealPageIds,
      sourceActionExternalId: input.externalId,
    });
    return { partial: false };
  } catch (error) {
    await input.deps.syncErrors.insert({
      stage: "next_action_recalc",
      entityType: "action",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "次回アクション再計算要求に失敗しました",
      detail: {
        error: error instanceof Error ? error.message : "unknown",
      },
    });
    input.deps.logger.error({
      request_id: input.requestId,
      message: "next_action_recalc_failed",
    });
    return {
      partial: true,
      warning:
        "保存は完了しましたが、次回アクション反映が遅れる可能性があります",
    };
  }
}

async function finishAfterNotion(input: {
  deps: ActionWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "action.create" | "action.update";
  notionPageId: string;
  externalId: string;
  write: ActionWriteInput;
  changedFields: Record<string, unknown> | null;
  previousCustomerPageId?: string | null;
  previousDealPageId?: string | null;
}): Promise<ActionWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "action",
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
      entityType: "action",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "audit_logsへの記録に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
  }

  let customerPageId: string | null = input.write.customerPageId;
  let dealPageId: string | null = input.write.dealPageId;
  try {
    const { action: loaded, lastEditedTime } = await loadActionPage(
      deps,
      input.notionPageId,
    );
    customerPageId = loaded.customerPageId;
    dealPageId = loaded.dealPageId;
    await upsertActionIndex({
      deps,
      action: loaded,
      lastEditedTime,
      partial,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "action",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "action_index更新に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
  }

  const recalc = await requestRecalcBestEffort({
    deps,
    requestId: input.requestId,
    customerPageIds: [customerPageId, input.previousCustomerPageId],
    dealPageIds: [dealPageId, input.previousDealPageId],
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
  deps: ActionWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: ActionWriteInput;
  operation: "create" | "update";
  previousCustomerPageId?: string | null;
  previousDealPageId?: string | null;
}): Promise<ActionWriteResult> {
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
    throw new ActionSyncError(
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
        throw new ActionSyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { action } = await loadActionPage(deps, op.notion_page_id);
      const currentHash = hashActionDomain(action);
      const expected = (
        op.recovery_payload as ActionRecoveryPayload | null
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
    action: input.operation === "create" ? "action.create" : "action.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
    previousCustomerPageId: input.previousCustomerPageId,
    previousDealPageId: input.previousDealPageId,
  });
}

export async function executeActionCreate(
  deps: ActionWriteDeps,
  command: ActionCreateCommand,
): Promise<ActionWriteResult> {
  let write = sanitizeActionWriteInput(command.input);
  write = await applyCompletedAtPolicy(deps, write);
  const inputHash = hashActionWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ActionSyncError(
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
    createdById: command.actorId,
    createdByName: command.actorName,
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
  deps: ActionWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: ActionWriteInput;
}): Promise<ActionWriteResult> {
  const { deps } = input;

  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    const properties = actionToNotionProperties({
      action: writeInputToActionDomainFields({
        externalId: input.externalId,
        write: input.write,
        createdById: input.actorId,
        createdByName: input.actorName,
      }),
      propertiesByName: deps.propertiesByName,
    });
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.actionsDataSourceId,
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
          throw new ActionSyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new ActionSyncError(
          "notion_failed",
          "Notionアクションページの作成に失敗しました",
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
    action: "action.create",
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

export async function executeActionUpdate(
  deps: ActionWriteDeps,
  command: ActionUpdateCommand,
): Promise<ActionWriteResult> {
  let write = sanitizeActionWriteInput(command.input);
  write = await applyCompletedAtPolicy(deps, write);
  const inputHash = hashActionWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ActionSyncError(
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
      throw new ActionSyncError(
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
        action: "action.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    if (existing.notion_page_id) {
      const { action } = await loadActionPage(deps, existing.notion_page_id);
      const currentHash = hashActionDomain(action);
      const expected = (
        existing.recovery_payload as ActionRecoveryPayload | null
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
          action: "action.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
          previousCustomerPageId: action.customerPageId,
          previousDealPageId: action.dealPageId,
        });
      }
    }
  }

  const { action, lastEditedTime } = await loadActionPage(
    deps,
    command.notionPageId,
  );
  if (action.inTrash) {
    throw new ActionSyncError(
      "in_trash",
      "ゴミ箱内のアクションは更新できません",
    );
  }
  if (action.externalId !== command.externalId) {
    throw new ActionSyncError("validation", "external_idが一致しません");
  }

  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new ActionSyncError(
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
    createdById: action.createdById,
    createdByName: action.createdByName,
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

  const currentHash = hashActionDomain(action);
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
      action: "action.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
      previousCustomerPageId: action.customerPageId,
      previousDealPageId: action.dealPageId,
    });
  }

  const diff = buildActionPropertyDiff({
    before: action,
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
        const { action: after } = await loadActionPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashActionDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
        } else {
          await deps.syncErrors.insert({
            stage: "ambiguous_update",
            entityType: "action",
            notionPageId: command.notionPageId,
            externalId: command.externalId,
            message:
              "Notion更新結果が曖昧で期待content_hashと不一致。自動再更新しない",
            detail: {
              expected_hash_prefix: recovery.expectedContentHash.slice(0, 8),
              actual_hash_prefix: afterHash.slice(0, 8),
            },
          });
          throw new ActionSyncError(
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
        throw new ActionSyncError(
          "notion_failed",
          "Notionアクションページの更新に失敗しました",
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
    action: "action.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildActionChangedFieldsAudit({ before: action, write }),
    previousCustomerPageId: action.customerPageId,
    previousDealPageId: action.dealPageId,
  });
}
