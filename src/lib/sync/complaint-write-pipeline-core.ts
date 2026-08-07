import type { Client } from "@notionhq/client";

import {
  hashComplaintWriteInput,
  sanitizeComplaintWriteInput,
} from "@/lib/complaints/input-hash";
import {
  hashComplaintDomain,
  hashComplaintWriteWithExternalId,
} from "@/lib/complaints/content-hash";
import { complaintDomainToIndexRow } from "@/lib/complaints/index-mapper";
import {
  isComplaintDoneSemantic,
  type ComplaintCreateCommand,
  type ComplaintRecoveryPayload,
  type ComplaintUpdateCommand,
  type ComplaintWriteInput,
  type ComplaintWriteResult,
  type WriteOperationRow,
} from "@/lib/complaints/types";
import {
  complaintToNotionProperties,
  notionPageToComplaint,
  type PropertyIdMap,
} from "@/lib/notion/converters/complaint";
import {
  buildManagedComplaintBodyBlocks,
  hashComplaintBody,
} from "@/lib/notion/converters/page-body";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import { todayDateTokyo } from "@/lib/normalize";
import { listAllChildBlocks } from "@/lib/sync/activity-body";
import { replaceManagedComplaintBody } from "@/lib/sync/complaint-body";
import {
  buildComplaintChangedFieldsAudit,
  buildComplaintPropertyDiff,
  writeInputToComplaintDomainFields,
} from "@/lib/sync/complaint-diff";
import { ComplaintSyncError } from "@/lib/sync/errors";

export type ComplaintWriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: ComplaintRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: ComplaintRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type ComplaintIndexStore = {
  upsert(row: ReturnType<typeof complaintDomainToIndexRow>): Promise<void>;
  resolveAssigneeUserId(staffPageId: string | null): Promise<string | null>;
  resolveStatusSemantic(statusPageId: string | null): Promise<string | null>;
  getCustomerDisplayName(customerPageId: string): Promise<string | null>;
  getDealTitle(dealPageId: string): Promise<string | null>;
  getStaffName(staffPageId: string): Promise<string | null>;
};

export type ComplaintAuditStore = {
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

export type ComplaintSyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type ComplaintWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type ComplaintWriteDeps = {
  notion: Client;
  complaintsDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: ComplaintWriteOpStore;
  index: ComplaintIndexStore;
  audit: ComplaintAuditStore;
  syncErrors: ComplaintSyncErrorStore;
  logger: ComplaintWriteLogger;
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
  deps: ComplaintWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.complaintsDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadComplaintPage(deps: ComplaintWriteDeps, pageId: string) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const blocks = await listAllChildBlocks(deps.notion, pageId);
  const complaint = await notionPageToComplaint({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
    blocks,
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, complaint, lastEditedTime, blocks };
}

/**
 * 対応状況が done で完了日が空なら Asia/Tokyo の今日を埋める。
 */
async function applyCompletedOnPolicy(
  deps: ComplaintWriteDeps,
  write: ComplaintWriteInput,
): Promise<ComplaintWriteInput> {
  const semantic = await deps.index.resolveStatusSemantic(write.statusPageId);
  if (isComplaintDoneSemantic(semantic) && !write.completedOn) {
    return { ...write, completedOn: todayDateTokyo() };
  }
  return write;
}

function bodySectionsOf(write: ComplaintWriteInput) {
  return {
    content: write.content,
    cause: write.cause,
    response: write.response,
    prevention: write.prevention,
  };
}

function buildRecoveryPayload(input: {
  write: ComplaintWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  bodyVersion: number;
  expectedLastEditedTime?: string;
  oldBlockIds?: string[];
  newBlockIds?: string[];
  bodyStage?: ComplaintRecoveryPayload["bodyStage"];
}): ComplaintRecoveryPayload {
  const domain = writeInputToComplaintDomainFields({
    externalId: input.externalId,
    write: input.write,
    bodyVersion: input.bodyVersion,
  });
  return {
    expectedProperties: complaintToNotionProperties({
      complaint: domain,
      propertiesByName: input.propertiesByName,
    }),
    expectedRelations: {
      customerPageId: input.write.customerPageId,
      dealPageId: input.write.dealPageId,
      severityPageId: input.write.severityPageId,
      statusPageId: input.write.statusPageId,
      staffPageId: input.write.staffPageId,
    },
    expectedContentHash: hashComplaintWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
      bodyVersion: input.bodyVersion,
    }),
    expectedBodyHash: hashComplaintBody(bodySectionsOf(input.write)),
    expectedBodyVersion: input.bodyVersion,
    oldBlockIds: input.oldBlockIds,
    newBlockIds: input.newBlockIds,
    bodyStage: input.bodyStage,
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function upsertComplaintIndex(input: {
  deps: ComplaintWriteDeps;
  complaint: Awaited<ReturnType<typeof loadComplaintPage>>["complaint"];
  lastEditedTime: string;
  partial: boolean;
}): Promise<void> {
  const { deps, complaint } = input;
  const contentHash = hashComplaintDomain(complaint);
  const [assigneeUserId, statusSemantic, customerDisplayName, dealTitle, staffName] =
    await Promise.all([
      deps.index.resolveAssigneeUserId(complaint.staffPageId),
      deps.index.resolveStatusSemantic(complaint.statusPageId),
      complaint.customerPageId
        ? deps.index.getCustomerDisplayName(complaint.customerPageId)
        : Promise.resolve(null),
      complaint.dealPageId
        ? deps.index.getDealTitle(complaint.dealPageId)
        : Promise.resolve(null),
      complaint.staffPageId
        ? deps.index.getStaffName(complaint.staffPageId)
        : Promise.resolve(null),
    ]);
  const row = complaintDomainToIndexRow({
    complaint,
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

async function finishAfterNotion(input: {
  deps: ComplaintWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "complaint.create" | "complaint.update";
  notionPageId: string;
  externalId: string;
  write: ComplaintWriteInput;
  changedFields: Record<string, unknown> | null;
}): Promise<ComplaintWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "complaint",
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
      entityType: "complaint",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "audit_logsへの記録に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
  }

  try {
    const { complaint, lastEditedTime } = await loadComplaintPage(
      deps,
      input.notionPageId,
    );
    await upsertComplaintIndex({
      deps,
      complaint,
      lastEditedTime,
      partial,
    });
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "complaint",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "complaint_index更新に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
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
  deps: ComplaintWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: ComplaintWriteInput;
  operation: "create" | "update";
}): Promise<ComplaintWriteResult> {
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
    throw new ComplaintSyncError(
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
        throw new ComplaintSyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { complaint } = await loadComplaintPage(deps, op.notion_page_id);
      const currentHash = hashComplaintDomain(complaint);
      const expected = (
        op.recovery_payload as ComplaintRecoveryPayload | null
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
      input.operation === "create" ? "complaint.create" : "complaint.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
  });
}

export async function executeComplaintCreate(
  deps: ComplaintWriteDeps,
  command: ComplaintCreateCommand,
): Promise<ComplaintWriteResult> {
  let write = sanitizeComplaintWriteInput(command.input);
  write = await applyCompletedOnPolicy(deps, write);
  const inputHash = hashComplaintWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ComplaintSyncError(
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
  deps: ComplaintWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: ComplaintWriteInput;
}): Promise<ComplaintWriteResult> {
  const { deps } = input;

  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    const domain = writeInputToComplaintDomainFields({
      externalId: input.externalId,
      write: input.write,
      bodyVersion: 1,
    });
    const properties = complaintToNotionProperties({
      complaint: domain,
      propertiesByName: deps.propertiesByName,
    });
    const children = buildManagedComplaintBodyBlocks({
      sections: bodySectionsOf(input.write),
      bodyVersion: 1,
    });
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.complaintsDataSourceId,
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
          throw new ComplaintSyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new ComplaintSyncError(
          "notion_failed",
          "Notionクレームページの作成に失敗しました",
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
    action: "complaint.create",
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

export async function executeComplaintUpdate(
  deps: ComplaintWriteDeps,
  command: ComplaintUpdateCommand,
): Promise<ComplaintWriteResult> {
  let write = sanitizeComplaintWriteInput(command.input);
  write = await applyCompletedOnPolicy(deps, write);
  const inputHash = hashComplaintWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ComplaintSyncError(
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
      throw new ComplaintSyncError(
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
        action: "complaint.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    if (existing.notion_page_id) {
      const { complaint } = await loadComplaintPage(
        deps,
        existing.notion_page_id,
      );
      const currentHash = hashComplaintDomain(complaint);
      const expected = (
        existing.recovery_payload as ComplaintRecoveryPayload | null
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
          action: "complaint.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
        });
      }
    }
  }

  const { complaint, lastEditedTime } = await loadComplaintPage(
    deps,
    command.notionPageId,
  );
  if (complaint.inTrash) {
    throw new ComplaintSyncError(
      "in_trash",
      "ゴミ箱内のクレームは更新できません",
    );
  }
  if (complaint.externalId !== command.externalId) {
    throw new ComplaintSyncError("validation", "external_idが一致しません");
  }

  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new ComplaintSyncError(
      "conflict",
      "他の変更があります。再読込してから保存してください",
      {
        expectedLastEditedTime: command.expectedLastEditedTime,
        actualLastEditedTime: lastEditedTime,
      },
    );
  }

  const nextBodyVersion =
    complaint.bodyVersion && complaint.bodyVersion >= 1
      ? complaint.bodyVersion + 1
      : 1;
  const beforeBodyHash = hashComplaintBody({
    content: complaint.content,
    cause: complaint.cause,
    response: complaint.response,
    prevention: complaint.prevention,
  });
  const afterBodyHash = hashComplaintBody(bodySectionsOf(write));
  const expectedBodyVersion =
    beforeBodyHash === afterBodyHash
      ? (complaint.bodyVersion ?? 1)
      : nextBodyVersion;

  const recovery = buildRecoveryPayload({
    write,
    externalId: command.externalId,
    propertiesByName: deps.propertiesByName,
    bodyVersion: expectedBodyVersion,
    expectedLastEditedTime: command.expectedLastEditedTime,
    oldBlockIds: complaint.managedBlockIds,
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

  const currentHash = hashComplaintDomain(complaint);
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
      action: "complaint.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
    });
  }

  const diff = buildComplaintPropertyDiff({
    before: complaint,
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
        const { complaint: after } = await loadComplaintPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashComplaintDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
        } else {
          const propsOnlyMatch =
            after.title === write.title &&
            after.summary === write.summary &&
            after.occurredOn === write.occurredOn;
          if (!propsOnlyMatch) {
            await deps.syncErrors.insert({
              stage: "ambiguous_update",
              entityType: "complaint",
              notionPageId: command.notionPageId,
              externalId: command.externalId,
              message:
                "Notion更新結果が曖昧で期待content_hashと不一致。自動再更新しない",
              detail: {
                expected_hash_prefix: recovery.expectedContentHash.slice(0, 8),
                actual_hash_prefix: afterHash.slice(0, 8),
              },
            });
            throw new ComplaintSyncError(
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
        throw new ComplaintSyncError(
          "notion_failed",
          "Notionクレームページの更新に失敗しました",
        );
      }
    }
  }

  const bodyChanged = beforeBodyHash !== afterBodyHash;
  if (bodyChanged || complaint.bodyVersion === null) {
    const oldContentExpected =
      Boolean(complaint.bodyVersion) ||
      Boolean(
        complaint.content ||
          complaint.cause ||
          complaint.response ||
          complaint.prevention,
      ) ||
      complaint.managedBlockIds.length > 0;
    try {
      const bodyResult = await replaceManagedComplaintBody({
        notion: deps.notion,
        pageId: command.notionPageId,
        sections: bodySectionsOf(write),
        nextBodyVersion: expectedBodyVersion,
        oldContentExpected,
      });
      recovery.oldBlockIds = bodyResult.oldBlockIds;
      recovery.newBlockIds = bodyResult.newBlockIds;
      recovery.expectedBodyVersion = bodyResult.bodyVersion;
      recovery.expectedBodyHash = bodyResult.bodyHash;
      recovery.bodyStage = "cleaned";
      recovery.expectedContentHash = hashComplaintWriteWithExternalId({
        externalId: command.externalId,
        write,
        bodyVersion: bodyResult.bodyVersion,
      });
    } catch (error) {
      if (error instanceof ComplaintSyncError) {
        await deps.writeOps.markFailed(command.requestId, error.message);
        throw error;
      }
      await deps.writeOps.markFailed(
        command.requestId,
        error instanceof Error ? error.message : "body_update_failed",
      );
      throw new ComplaintSyncError(
        "notion_failed",
        "クレームの本文更新に失敗しました",
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
    action: "complaint.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildComplaintChangedFieldsAudit({
      before: complaint,
      write,
    }),
  });
}
