import type { Client } from "@notionhq/client";

import {
  hashActivityWriteInput,
  sanitizeActivityWriteInput,
} from "@/lib/activities/input-hash";
import {
  hashActivityDomain,
  hashActivityWriteWithExternalId,
} from "@/lib/activities/content-hash";
import { activityDomainToIndexRow } from "@/lib/activities/index-mapper";
import type {
  ActivityCreateCommand,
  ActivityRecoveryPayload,
  ActivityUpdateCommand,
  ActivityWriteInput,
  ActivityWriteResult,
  WriteOperationRow,
} from "@/lib/activities/types";
import {
  activityToNotionProperties,
  notionPageToActivity,
  type PropertyIdMap,
} from "@/lib/notion/converters/activity";
import {
  buildManagedActivityBodyBlocks,
  hashActivityBody,
} from "@/lib/notion/converters/page-body";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import {
  listAllChildBlocks,
  replaceManagedActivityBody,
} from "@/lib/sync/activity-body";
import {
  buildActivityChangedFieldsAudit,
  buildActivityPropertyDiff,
  writeInputToActivityDomainFields,
} from "@/lib/sync/activity-diff";
import { ActivitySyncError } from "@/lib/sync/errors";

export type ActivityWriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: ActivityRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: ActivityRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type ActivityIndexStore = {
  upsert(row: ReturnType<typeof activityDomainToIndexRow>): Promise<void>;
  getCustomerDisplayName(customerPageId: string): Promise<string | null>;
  getContactNames(contactPageIds: string[]): Promise<string[]>;
  getDealTitle(dealPageId: string): Promise<string | null>;
  getCategoryNames(categoryPageIds: string[]): Promise<string[]>;
};

export type ActivityAuditStore = {
  insert(input: {
    actorId: string;
    actorName: string;
    action: string;
    entityType: string;
    notionPageId: string;
    changedFields: Record<string, unknown> | null;
    operationSource: string;
    requestId: string;
    batchId?: string | null;
  }): Promise<void>;
};

export type ActivitySyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type ActivityLatestRecalc = {
  requestForCustomers(input: {
    customerPageIds: Array<string | null | undefined>;
    sourceActivityExternalId?: string;
  }): Promise<void>;
};

export type ActivityWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type ActivityWriteDeps = {
  notion: Client;
  activitiesDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: ActivityWriteOpStore;
  index: ActivityIndexStore;
  audit: ActivityAuditStore;
  syncErrors: ActivitySyncErrorStore;
  latestActivityRecalc: ActivityLatestRecalc;
  logger: ActivityWriteLogger;
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
  deps: ActivityWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.activitiesDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadActivityPage(deps: ActivityWriteDeps, pageId: string) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const blocks = await listAllChildBlocks(deps.notion, pageId);
  const activity = await notionPageToActivity({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
    blocks,
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, activity, lastEditedTime, blocks };
}

function buildRecoveryPayload(input: {
  write: ActivityWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  actor: {
    createdById: string | null;
    createdByName: string | null;
    updatedById: string | null;
    updatedByName: string | null;
  };
  bodyVersion: number;
  expectedLastEditedTime?: string;
  oldBlockIds?: string[];
  newBlockIds?: string[];
  bodyStage?: ActivityRecoveryPayload["bodyStage"];
}): ActivityRecoveryPayload {
  const domain = writeInputToActivityDomainFields({
    externalId: input.externalId,
    write: input.write,
    createdById: input.actor.createdById,
    createdByName: input.actor.createdByName,
    updatedById: input.actor.updatedById,
    updatedByName: input.actor.updatedByName,
    bodyVersion: input.bodyVersion,
  });
  return {
    expectedProperties: activityToNotionProperties({
      activity: domain,
      propertiesByName: input.propertiesByName,
    }),
    expectedRelations: {
      customerPageId: input.write.customerPageId,
      dealPageId: input.write.dealPageId,
      contactPageIds: input.write.contactPageIds,
      categoryPageIds: input.write.categoryPageIds,
    },
    expectedContentHash: hashActivityWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
      actor: input.actor,
      bodyVersion: input.bodyVersion,
    }),
    expectedBodyHash: hashActivityBody(input.write.body),
    expectedBodyVersion: input.bodyVersion,
    oldBlockIds: input.oldBlockIds,
    newBlockIds: input.newBlockIds,
    bodyStage: input.bodyStage,
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function upsertActivityIndex(input: {
  deps: ActivityWriteDeps;
  activity: Awaited<ReturnType<typeof loadActivityPage>>["activity"];
  lastEditedTime: string;
  partial: boolean;
}): Promise<void> {
  const { deps, activity } = input;
  const contentHash = hashActivityDomain(activity);
  const [customerDisplayName, contactNames, dealTitle, categoryNames] =
    await Promise.all([
      activity.customerPageId
        ? deps.index.getCustomerDisplayName(activity.customerPageId)
        : Promise.resolve(null),
      deps.index.getContactNames(activity.contactPageIds),
      activity.dealPageId
        ? deps.index.getDealTitle(activity.dealPageId)
        : Promise.resolve(null),
      deps.index.getCategoryNames(activity.categoryPageIds),
    ]);
  const row = activityDomainToIndexRow({
    activity,
    contentHash,
    notionLastEditedAt: input.lastEditedTime || null,
    syncStatus: input.partial ? "error" : "synced",
    syncErrorMessage: input.partial ? "partial_failure_after_notion" : null,
    customerDisplayName,
    contactNames,
    dealTitle,
    categoryNames,
  });
  await deps.index.upsert(row);
}

async function requestRecalcBestEffort(input: {
  deps: ActivityWriteDeps;
  requestId: string;
  customerPageIds: Array<string | null | undefined>;
  notionPageId: string;
  externalId: string;
}): Promise<{ partial: boolean; warning?: string }> {
  try {
    await input.deps.latestActivityRecalc.requestForCustomers({
      customerPageIds: input.customerPageIds,
      sourceActivityExternalId: input.externalId,
    });
    return { partial: false };
  } catch (error) {
    await input.deps.syncErrors.insert({
      stage: "latest_activity_recalc",
      entityType: "activity",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "顧客の最新対応内容再計算要求に失敗しました",
      detail: {
        error: error instanceof Error ? error.message : "unknown",
      },
    });
    input.deps.logger.error({
      request_id: input.requestId,
      message: "latest_activity_recalc_failed",
    });
    return {
      partial: true,
      warning:
        "保存は完了しましたが、顧客の最新対応内容反映が遅れる可能性があります",
    };
  }
}

async function finishAfterNotion(input: {
  deps: ActivityWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "activity.create" | "activity.update";
  notionPageId: string;
  externalId: string;
  write: ActivityWriteInput;
  changedFields: Record<string, unknown> | null;
  previousCustomerPageId?: string | null;
}): Promise<ActivityWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "activity",
      notionPageId: input.notionPageId,
      changedFields: input.changedFields,
      operationSource: "app",
      requestId: input.requestId,
      batchId: input.write.batchId,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "audit_write",
      entityType: "activity",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "audit_logsへの記録に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
  }

  let customerPageId: string | null = input.write.customerPageId;
  try {
    const { activity, lastEditedTime } = await loadActivityPage(
      deps,
      input.notionPageId,
    );
    customerPageId = activity.customerPageId;
    await upsertActivityIndex({
      deps,
      activity,
      lastEditedTime,
      partial,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "activity",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "activity_index更新に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
  }

  const recalc = await requestRecalcBestEffort({
    deps,
    requestId: input.requestId,
    customerPageIds: [customerPageId, input.previousCustomerPageId],
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
  deps: ActivityWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: ActivityWriteInput;
  operation: "create" | "update";
  previousCustomerPageId?: string | null;
}): Promise<ActivityWriteResult> {
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
    throw new ActivitySyncError(
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
        throw new ActivitySyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { activity } = await loadActivityPage(deps, op.notion_page_id);
      const currentHash = hashActivityDomain(activity);
      const expected = (
        op.recovery_payload as ActivityRecoveryPayload | null
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
    action: input.operation === "create" ? "activity.create" : "activity.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
    previousCustomerPageId: input.previousCustomerPageId,
  });
}

export async function executeActivityCreate(
  deps: ActivityWriteDeps,
  command: ActivityCreateCommand,
): Promise<ActivityWriteResult> {
  const write = sanitizeActivityWriteInput(command.input);
  const inputHash = hashActivityWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ActivitySyncError(
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
    actor: {
      createdById: command.actorId,
      createdByName: command.actorName,
      updatedById: command.actorId,
      updatedByName: command.actorName,
    },
    bodyVersion: 1,
    bodyStage: "pending",
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
  deps: ActivityWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: ActivityWriteInput;
}): Promise<ActivityWriteResult> {
  const { deps } = input;

  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    const domain = writeInputToActivityDomainFields({
      externalId: input.externalId,
      write: input.write,
      createdById: input.actorId,
      createdByName: input.actorName,
      updatedById: input.actorId,
      updatedByName: input.actorName,
      bodyVersion: 1,
    });
    const properties = activityToNotionProperties({
      activity: domain,
      propertiesByName: deps.propertiesByName,
    });
    const children = buildManagedActivityBodyBlocks({
      body: input.write.body,
      bodyVersion: 1,
    });
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.activitiesDataSourceId,
        },
        properties,
        children,
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
          throw new ActivitySyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new ActivitySyncError(
          "notion_failed",
          "Notion対応履歴ページの作成に失敗しました",
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
    action: "activity.create",
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

export async function executeActivityUpdate(
  deps: ActivityWriteDeps,
  command: ActivityUpdateCommand,
): Promise<ActivityWriteResult> {
  const write = sanitizeActivityWriteInput(command.input);
  const inputHash = hashActivityWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ActivitySyncError(
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
      throw new ActivitySyncError(
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
        action: "activity.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    if (existing.notion_page_id) {
      const { activity } = await loadActivityPage(deps, existing.notion_page_id);
      const currentHash = hashActivityDomain(activity);
      const expected = (
        existing.recovery_payload as ActivityRecoveryPayload | null
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
          action: "activity.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
          previousCustomerPageId: activity.customerPageId,
        });
      }
    }
  }

  const { activity, lastEditedTime } = await loadActivityPage(
    deps,
    command.notionPageId,
  );
  if (activity.inTrash) {
    throw new ActivitySyncError(
      "in_trash",
      "ゴミ箱内の対応履歴は更新できません",
    );
  }
  if (activity.externalId !== command.externalId) {
    throw new ActivitySyncError("validation", "external_idが一致しません");
  }

  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new ActivitySyncError(
      "conflict",
      "他の変更があります。再読込してから保存してください",
      {
        expectedLastEditedTime: command.expectedLastEditedTime,
        actualLastEditedTime: lastEditedTime,
      },
    );
  }

  const nextBodyVersion =
    activity.bodyVersion && activity.bodyVersion >= 1
      ? activity.bodyVersion + 1
      : 1;
  const expectedBodyVersion =
    hashActivityBody(activity.body) === hashActivityBody(write.body)
      ? (activity.bodyVersion ?? 1)
      : nextBodyVersion;

  const actor = {
    createdById: activity.createdById,
    createdByName: activity.createdByName,
    updatedById: command.actorId,
    updatedByName: command.actorName,
  };

  const recovery = buildRecoveryPayload({
    write,
    externalId: command.externalId,
    propertiesByName: deps.propertiesByName,
    actor,
    bodyVersion: expectedBodyVersion,
    expectedLastEditedTime: command.expectedLastEditedTime,
    oldBlockIds: activity.managedBlockIds,
    bodyStage: "pending",
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

  const currentHash = hashActivityDomain(activity);
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
      action: "activity.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
      previousCustomerPageId: activity.customerPageId,
    });
  }

  const diff = buildActivityPropertyDiff({
    before: activity,
    write,
    actorId: command.actorId,
    actorName: command.actorName,
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
        const { activity: after } = await loadActivityPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashActivityDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
        } else {
          // 本文未反映の可能性があるため props だけ一致でも継続せず確認へ
          const propsOnlyMatch =
            after.title === write.title &&
            after.summary === write.summary &&
            after.activityAt === write.activityAt;
          if (!propsOnlyMatch) {
            await deps.syncErrors.insert({
              stage: "ambiguous_update",
              entityType: "activity",
              notionPageId: command.notionPageId,
              externalId: command.externalId,
              message:
                "Notion更新結果が曖昧で期待content_hashと不一致。自動再更新しない",
              detail: {
                expected_hash_prefix: recovery.expectedContentHash.slice(0, 8),
                actual_hash_prefix: afterHash.slice(0, 8),
              },
            });
            throw new ActivitySyncError(
              "ambiguous_write",
              "Notion更新結果を判定できませんでした。管理者による確認が必要です",
              { stage: "ambiguous_update" },
            );
          }
        }
      } else {
        await deps.writeOps.markFailed(
          command.requestId,
          error instanceof Error ? error.message : "notion_update_failed",
        );
        throw new ActivitySyncError(
          "notion_failed",
          "Notion対応履歴ページの更新に失敗しました",
        );
      }
    }
  }

  const bodyChanged =
    hashActivityBody(activity.body) !== hashActivityBody(write.body);
  if (bodyChanged || activity.bodyVersion === null) {
    const oldContentExpected =
      Boolean(activity.bodyVersion) ||
      activity.body.length > 0 ||
      activity.managedBlockIds.length > 0;
    try {
      const bodyResult = await replaceManagedActivityBody({
        notion: deps.notion,
        pageId: command.notionPageId,
        body: write.body,
        nextBodyVersion: expectedBodyVersion,
        oldContentExpected,
      });
      recovery.oldBlockIds = bodyResult.oldBlockIds;
      recovery.newBlockIds = bodyResult.newBlockIds;
      recovery.expectedBodyVersion = bodyResult.bodyVersion;
      recovery.expectedBodyHash = bodyResult.bodyHash;
      recovery.bodyStage = "cleaned";
      recovery.expectedContentHash = hashActivityWriteWithExternalId({
        externalId: command.externalId,
        write,
        actor,
        bodyVersion: bodyResult.bodyVersion,
      });
    } catch (error) {
      if (error instanceof ActivitySyncError) {
        await deps.writeOps.markFailed(command.requestId, error.message);
        throw error;
      }
      await deps.writeOps.markFailed(
        command.requestId,
        error instanceof Error ? error.message : "body_update_failed",
      );
      throw new ActivitySyncError(
        "notion_failed",
        "対応履歴の本文更新に失敗しました",
      );
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
    action: "activity.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildActivityChangedFieldsAudit({ before: activity, write }),
    previousCustomerPageId: activity.customerPageId,
  });
}
