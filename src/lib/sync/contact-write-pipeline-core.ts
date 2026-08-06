import type { Client } from "@notionhq/client";

import {
  hashContactWriteInput,
  sanitizeContactWriteInput,
} from "@/lib/contacts/input-hash";
import {
  hashContactDomain,
  hashContactWriteWithExternalId,
} from "@/lib/contacts/content-hash";
import { contactDomainToIndexRow } from "@/lib/contacts/index-mapper";
import type {
  ContactCreateCommand,
  ContactRecoveryPayload,
  ContactUpdateCommand,
  ContactWriteInput,
  ContactWriteResult,
  WriteOperationRow,
} from "@/lib/contacts/types";
import {
  contactToNotionProperties,
  notionPageToContact,
  type PropertyIdMap,
} from "@/lib/notion/converters/contact";
import type { PagePropertyPager } from "@/lib/notion/converters/relations";
import { NotionHttpError } from "@/lib/notion/client-core";
import { newRequestId } from "@/lib/notion/ids";
import {
  buildChangedFieldsAudit,
  buildContactPropertyDiff,
  writeInputToDomainFields,
} from "@/lib/sync/contact-diff";
import { ContactSyncError } from "@/lib/sync/errors";

export type ContactWriteOpStore = {
  getByRequestId(requestId: string): Promise<WriteOperationRow | null>;
  insertPending(row: {
    requestId: string;
    operation: "create" | "update";
    externalId: string;
    inputHash: string;
    actorId: string;
    recoveryPayload: ContactRecoveryPayload | null;
    notionPageId?: string | null;
  }): Promise<void>;
  markNotionDone(input: {
    requestId: string;
    notionPageId: string;
    recoveryPayload?: ContactRecoveryPayload | null;
  }): Promise<void>;
  markCompleted(requestId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
};

export type ContactIndexStore = {
  upsert(row: ReturnType<typeof contactDomainToIndexRow>): Promise<void>;
};

/** 所属顧客の search_text を担当者名で再構築(best-effort) */
export type CustomerSearchRefresh = {
  refreshForCustomer(customerPageId: string): Promise<void>;
  getDisplayName(customerPageId: string): Promise<string | null>;
};

export type ContactAuditStore = {
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

export type ContactSyncErrorStore = {
  insert(input: {
    stage: string;
    entityType: string;
    notionPageId?: string | null;
    externalId?: string | null;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
};

export type ContactWriteLogger = {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
};

export type ContactWriteDeps = {
  notion: Client;
  contactsDataSourceId: string;
  propertiesByName: PropertyIdMap;
  writeOps: ContactWriteOpStore;
  index: ContactIndexStore;
  audit: ContactAuditStore;
  syncErrors: ContactSyncErrorStore;
  customerSearch: CustomerSearchRefresh;
  logger: ContactWriteLogger;
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
  deps: ContactWriteDeps,
  externalId: string,
): Promise<{ id: string } | null> {
  const found = await deps.notion.dataSources.query({
    data_source_id: deps.contactsDataSourceId,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 1,
  } as never);
  const results = (found as { results: Array<{ id: string }> }).results;
  return results[0] ?? null;
}

async function loadContactPage(deps: ContactWriteDeps, pageId: string) {
  const page = await deps.notion.pages.retrieve({ page_id: pageId });
  const contact = await notionPageToContact({
    page: page as never,
    propertiesByName: deps.propertiesByName,
    pager: deps.pager ?? defaultPager(deps.notion),
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { page, contact, lastEditedTime };
}

function buildRecoveryPayload(input: {
  write: ContactWriteInput;
  externalId: string;
  propertiesByName: PropertyIdMap;
  expectedLastEditedTime?: string;
}): ContactRecoveryPayload {
  const domain = writeInputToDomainFields(input.externalId, input.write);
  return {
    expectedProperties: contactToNotionProperties({
      contact: domain,
      propertiesByName: input.propertiesByName,
    }),
    expectedRelations: {
      customerPageId: input.write.customerPageId,
      contactTypePageId: input.write.contactTypePageId,
    },
    expectedContentHash: hashContactWriteWithExternalId({
      externalId: input.externalId,
      write: input.write,
    }),
    expectedLastEditedTime: input.expectedLastEditedTime,
    displaySnapshot: input.write,
  };
}

async function refreshCustomerSearchBestEffort(input: {
  deps: ContactWriteDeps;
  requestId: string;
  customerPageIds: Array<string | null | undefined>;
  notionPageId: string;
  externalId: string;
}): Promise<{ partial: boolean; warning?: string }> {
  const unique = [
    ...new Set(
      input.customerPageIds.filter((id): id is string => Boolean(id)),
    ),
  ];
  let partial = false;
  let warning: string | undefined;
  for (const customerPageId of unique) {
    try {
      await input.deps.customerSearch.refreshForCustomer(customerPageId);
    } catch (error) {
      partial = true;
      warning =
        "保存は完了しましたが、検索への反映が遅れる可能性があります";
      await input.deps.syncErrors.insert({
        stage: "customer_search_refresh",
        entityType: "contact",
        notionPageId: input.notionPageId,
        externalId: input.externalId,
        message: "所属顧客のsearch_text再構築に失敗しました",
        detail: {
          error: error instanceof Error ? error.message : "unknown",
          customer_page_id: customerPageId,
        },
      });
      input.deps.logger.error({
        request_id: input.requestId,
        message: "customer_search_refresh_failed",
      });
    }
  }
  return { partial, warning };
}

async function finishAfterNotion(input: {
  deps: ContactWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  action: "contact.create" | "contact.update";
  notionPageId: string;
  externalId: string;
  write: ContactWriteInput;
  changedFields: Record<string, unknown> | null;
  previousCustomerPageId?: string | null;
}): Promise<ContactWriteResult> {
  const { deps } = input;
  let partial = false;
  let warning: string | undefined;

  try {
    await deps.audit.insert({
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: "contact",
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
      entityType: "contact",
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

  let contactCustomerPageId: string | null = input.write.customerPageId;
  try {
    const { contact, lastEditedTime } = await loadContactPage(
      deps,
      input.notionPageId,
    );
    contactCustomerPageId = contact.customerPageId;
    const contentHash = hashContactDomain(contact);
    const customerDisplayName = contact.customerPageId
      ? await deps.customerSearch.getDisplayName(contact.customerPageId)
      : null;
    const row = contactDomainToIndexRow({
      contact,
      contentHash,
      notionLastEditedAt: lastEditedTime || null,
      syncStatus: partial ? "error" : "synced",
      syncErrorMessage: partial ? "partial_failure_after_notion" : null,
      customerDisplayName,
    });
    await deps.index.upsert(row);
  } catch (error) {
    partial = true;
    warning =
      "保存は完了しましたが、検索への反映が遅れる可能性があります";
    await deps.syncErrors.insert({
      stage: "index_update",
      entityType: "contact",
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      message: "contact_index更新に失敗しました",
      detail: { error: error instanceof Error ? error.message : "unknown" },
    });
    deps.logger.error({
      request_id: input.requestId,
      message: "index_update_failed",
    });
  }

  const refresh = await refreshCustomerSearchBestEffort({
    deps,
    requestId: input.requestId,
    customerPageIds: [
      contactCustomerPageId,
      input.previousCustomerPageId,
    ],
    notionPageId: input.notionPageId,
    externalId: input.externalId,
  });
  if (refresh.partial) {
    partial = true;
    warning = refresh.warning ?? warning;
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
  deps: ContactWriteDeps;
  op: WriteOperationRow;
  actorId: string;
  actorName: string;
  write: ContactWriteInput;
  operation: "create" | "update";
  previousCustomerPageId?: string | null;
}): Promise<ContactWriteResult> {
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
    throw new ContactSyncError(
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
        throw new ContactSyncError(
          "validation",
          "update操作にnotion_page_idがありません",
        );
      }
      const { contact } = await loadContactPage(deps, op.notion_page_id);
      const currentHash = hashContactDomain(contact);
      const expected = (
        op.recovery_payload as ContactRecoveryPayload | null
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
      input.operation === "create" ? "contact.create" : "contact.update",
    notionPageId,
    externalId: op.external_id,
    write: input.write,
    changedFields: null,
    previousCustomerPageId: input.previousCustomerPageId,
  });
}

export async function executeContactCreate(
  deps: ContactWriteDeps,
  command: ContactCreateCommand,
): Promise<ContactWriteResult> {
  const write = sanitizeContactWriteInput(command.input);
  const inputHash = hashContactWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ContactSyncError(
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
  deps: ContactWriteDeps;
  requestId: string;
  actorId: string;
  actorName: string;
  externalId: string;
  write: ContactWriteInput;
}): Promise<ContactWriteResult> {
  const { deps } = input;

  const existing = await findPageByExternalId(deps, input.externalId);
  let notionPageId = existing?.id;

  if (!notionPageId) {
    const properties = contactToNotionProperties({
      contact: writeInputToDomainFields(input.externalId, input.write),
      propertiesByName: deps.propertiesByName,
    });
    try {
      const created = await deps.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: deps.contactsDataSourceId,
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
          throw new ContactSyncError(
            "ambiguous_write",
            "Notion作成結果が曖昧です。external_idで再照会してください",
          );
        }
      } else {
        await deps.writeOps.markFailed(
          input.requestId,
          error instanceof Error ? error.message : "notion_create_failed",
        );
        throw new ContactSyncError(
          "notion_failed",
          "Notion顧客担当者ページの作成に失敗しました",
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
    action: "contact.create",
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

export async function executeContactUpdate(
  deps: ContactWriteDeps,
  command: ContactUpdateCommand,
): Promise<ContactWriteResult> {
  const write = sanitizeContactWriteInput(command.input);
  const inputHash = hashContactWriteInput(write);
  const existing = await deps.writeOps.getByRequestId(command.requestId);

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new ContactSyncError(
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
      throw new ContactSyncError(
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
        action: "contact.update",
        notionPageId: existing.notion_page_id,
        externalId: existing.external_id,
        write,
        changedFields: null,
      });
    }
    if (existing.notion_page_id) {
      const { contact } = await loadContactPage(
        deps,
        existing.notion_page_id,
      );
      const currentHash = hashContactDomain(contact);
      const expected = (
        existing.recovery_payload as ContactRecoveryPayload | null
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
          action: "contact.update",
          notionPageId: existing.notion_page_id,
          externalId: existing.external_id,
          write,
          changedFields: null,
          previousCustomerPageId: contact.customerPageId,
        });
      }
    }
  }

  const { contact, lastEditedTime } = await loadContactPage(
    deps,
    command.notionPageId,
  );
  if (contact.inTrash) {
    throw new ContactSyncError(
      "in_trash",
      "ゴミ箱内の担当者は更新できません",
    );
  }
  if (contact.externalId !== command.externalId) {
    throw new ContactSyncError(
      "validation",
      "external_idが一致しません",
    );
  }

  if (!existing && lastEditedTime !== command.expectedLastEditedTime) {
    deps.logger.warn({
      request_id: command.requestId,
      message: "optimistic_lock_conflict",
      expected: command.expectedLastEditedTime,
      actual: lastEditedTime,
    });
    throw new ContactSyncError(
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

  const currentHash = hashContactDomain(contact);
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
      action: "contact.update",
      notionPageId: command.notionPageId,
      externalId: command.externalId,
      write,
      changedFields: {},
      previousCustomerPageId: contact.customerPageId,
    });
  }

  const diff = buildContactPropertyDiff({
    before: contact,
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
        const { contact: after } = await loadContactPage(
          deps,
          command.notionPageId,
        );
        const afterHash = hashContactDomain(after);
        if (afterHash === recovery.expectedContentHash) {
          deps.logger.warn({
            request_id: command.requestId,
            message: "update_ambiguous_recovered_by_content_hash",
          });
        } else {
          await deps.syncErrors.insert({
            stage: "ambiguous_update",
            entityType: "contact",
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
          throw new ContactSyncError(
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
        throw new ContactSyncError(
          "notion_failed",
          "Notion顧客担当者ページの更新に失敗しました",
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
    action: "contact.update",
    notionPageId: command.notionPageId,
    externalId: command.externalId,
    write,
    changedFields: buildChangedFieldsAudit({ before: contact, write }),
    previousCustomerPageId: contact.customerPageId,
  });
}
