import { createHash } from "node:crypto";

import type { ActivityDomain } from "@/lib/notion/converters/activity";
import type { ActivityWriteInput } from "@/lib/activities/types";
import { hashActivityBody } from "@/lib/notion/converters/page-body";

function sorted(ids: string[]) {
  return [...ids].sort();
}

/**
 * 楽観ロック・復旧比較用の content_hash。
 * 本文は全文ではなく bodyHash(SHA-256)を含める。
 */
export function hashActivityDomain(
  activity: Omit<ActivityDomain, "notionPageId" | "inTrash" | "managedBlockIds">,
): string {
  const payload = {
    externalId: activity.externalId,
    title: activity.title,
    customerPageId: activity.customerPageId,
    dealPageId: activity.dealPageId,
    contactPageIds: sorted(activity.contactPageIds),
    activityAt: activity.activityAt,
    categoryPageIds: sorted(activity.categoryPageIds),
    summary: activity.summary,
    nextActionNote: activity.nextActionNote,
    nextActionDate: activity.nextActionDate,
    createdById: activity.createdById,
    createdByName: activity.createdByName,
    updatedById: activity.updatedById,
    updatedByName: activity.updatedByName,
    batchId: activity.batchId,
    bodyHash: activity.bodyHash || hashActivityBody(activity.body),
    bodyVersion: activity.bodyVersion,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function hashActivityWriteWithExternalId(input: {
  externalId: string;
  write: ActivityWriteInput;
  actor: {
    createdById: string | null;
    createdByName: string | null;
    updatedById: string | null;
    updatedByName: string | null;
  };
  bodyVersion: number | null;
}): string {
  const bodyHash = hashActivityBody(input.write.body);
  return hashActivityDomain({
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
    createdById: input.actor.createdById,
    createdByName: input.actor.createdByName,
    updatedById: input.actor.updatedById,
    updatedByName: input.actor.updatedByName,
    batchId: input.write.batchId,
    body: input.write.body,
    bodyVersion: input.bodyVersion,
    bodyHash,
  });
}
