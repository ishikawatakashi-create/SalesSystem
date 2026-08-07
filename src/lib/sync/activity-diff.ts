import type { ActivityDomain } from "@/lib/notion/converters/activity";
import type { ActivityWriteInput } from "@/lib/activities/types";
import {
  activityToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/activity";
import { hashActivityBody } from "@/lib/notion/converters/page-body";

/** create時に登録者を固定し、update時は最終編集者のみ更新する */
export function writeInputToActivityDomainFields(input: {
  externalId: string;
  write: ActivityWriteInput;
  createdById: string | null;
  createdByName: string | null;
  updatedById: string | null;
  updatedByName: string | null;
  bodyVersion: number | null;
}): Omit<
  ActivityDomain,
  "notionPageId" | "inTrash" | "managedBlockIds"
> {
  const bodyHash = hashActivityBody(input.write.body);
  return {
    externalId: input.externalId,
    title: input.write.title,
    customerPageId: input.write.customerPageId,
    dealPageId: input.write.dealPageId,
    contactPageIds: input.write.contactPageIds,
    activityAt: input.write.activityAt,
    categoryPageIds: input.write.categoryPageIds,
    summary: input.write.summary,
    nextActionNote: input.write.nextActionNote,
    nextActionDate: input.write.nextActionDate,
    createdById: input.createdById,
    createdByName: input.createdByName,
    updatedById: input.updatedById,
    updatedByName: input.updatedByName,
    batchId: input.write.batchId,
    body: input.write.body,
    bodyVersion: input.bodyVersion,
    bodyHash,
  };
}

export function buildActivityPropertyDiff(input: {
  before: ActivityDomain;
  write: ActivityWriteInput;
  actorId: string;
  actorName: string;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain = writeInputToActivityDomainFields({
    externalId: input.before.externalId,
    write: input.write,
    createdById: input.before.createdById,
    createdByName: input.before.createdByName,
    updatedById: input.actorId,
    updatedByName: input.actorName,
    bodyVersion: input.before.bodyVersion,
  });

  const beforeProps = activityToNotionProperties({
    activity: {
      externalId: input.before.externalId,
      title: input.before.title,
      customerPageId: input.before.customerPageId,
      dealPageId: input.before.dealPageId,
      contactPageIds: input.before.contactPageIds,
      activityAt: input.before.activityAt,
      categoryPageIds: input.before.categoryPageIds,
      summary: input.before.summary,
      nextActionNote: input.before.nextActionNote,
      nextActionDate: input.before.nextActionDate,
      createdById: input.before.createdById,
      createdByName: input.before.createdByName,
      updatedById: input.before.updatedById,
      updatedByName: input.before.updatedByName,
      batchId: input.before.batchId,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = activityToNotionProperties({
    activity: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  // 登録者は更新で上書きしない
  const createdByNames = ["登録者ID", "登録者名"] as const;
  const skipIds = new Set(
    createdByNames
      .map((n) => input.propertiesByName[n]?.id)
      .filter((id): id is string => Boolean(id)),
  );

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterProps)) {
    if (skipIds.has(key)) continue;
    const before = beforeProps[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      diff[key] = value;
    }
  }
  return diff;
}

export function buildActivityChangedFieldsAudit(input: {
  before: ActivityDomain;
  write: ActivityWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["タイトル", input.before.title, input.write.title],
    ["顧客アカウント", input.before.customerPageId, input.write.customerPageId],
    ["関連案件", input.before.dealPageId, input.write.dealPageId],
    ["顧客担当者", input.before.contactPageIds, input.write.contactPageIds],
    ["対応日時", input.before.activityAt, input.write.activityAt],
    ["対応分類", input.before.categoryPageIds, input.write.categoryPageIds],
    ["要約", input.before.summary, input.write.summary],
    [
      "次回アクション(入力記録)",
      input.before.nextActionNote,
      input.write.nextActionNote,
    ],
    [
      "次回予定日(入力記録)",
      input.before.nextActionDate,
      input.write.nextActionDate,
    ],
    ["batch_id", input.before.batchId, input.write.batchId],
  ];
  for (const [field, before, after] of pairs) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }

  const beforeBodyHash = input.before.bodyHash;
  const afterBodyHash = hashActivityBody(input.write.body);
  if (beforeBodyHash !== afterBodyHash) {
    changed["本文"] = {
      before: {
        hash: beforeBodyHash,
        summary: input.before.summary,
        length: input.before.body.length,
      },
      after: {
        hash: afterBodyHash,
        summary: input.write.summary,
        length: input.write.body.length,
      },
    };
  }
  return changed;
}
