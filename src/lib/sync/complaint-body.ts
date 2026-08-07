/**
 * クレームページ本文の append → verify → delete ヘルパー。
 * 未マークの手動ブロックは削除しない。活動履歴と同じマーカー様式。
 */

import type { Client } from "@notionhq/client";

import {
  buildManagedComplaintBodyBlocks,
  collectAllManagedBlockIds,
  extractManagedComplaintBody,
  findManagedSections,
  hashComplaintBody,
  type ComplaintBodySections,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";
import { ComplaintSyncError } from "@/lib/sync/errors";
import { listAllChildBlocks } from "@/lib/sync/activity-body";

const APPEND_CHUNK = 100;

export type ComplaintBodyReplaceResult = {
  bodyVersion: number;
  bodyHash: string;
  oldBlockIds: string[];
  newBlockIds: string[];
};

function sectionsEqual(
  a: ComplaintBodySections,
  b: ComplaintBodySections,
): boolean {
  return hashComplaintBody(a) === hashComplaintBody(b);
}

/**
 * 管理セクションを追加し、期待 version の存在を検証してから旧管理ブロックのみ削除する。
 */
export async function replaceManagedComplaintBody(input: {
  notion: Client;
  pageId: string;
  sections: ComplaintBodySections;
  /** 新規セクションの version。省略時は既存最大+1(無ければ1) */
  nextBodyVersion?: number;
  /** true のとき、旧本文が期待されるのに管理セクションが無いと throw */
  oldContentExpected?: boolean;
}): Promise<ComplaintBodyReplaceResult> {
  const { notion, pageId } = input;
  const beforeBlocks = await listAllChildBlocks(notion, pageId);
  const sections = findManagedSections(beforeBlocks);
  const current = extractManagedComplaintBody(beforeBlocks);

  if (
    input.oldContentExpected &&
    !current &&
    beforeBlocks.length > 0 &&
    sections.length === 0
  ) {
    throw new ComplaintSyncError(
      "ambiguous_write",
      "管理セクションを識別できないため本文を更新できません",
      { stage: "body_managed_section_missing" },
    );
  }

  if (current && sectionsEqual(current.sections, input.sections)) {
    return {
      bodyVersion: current.bodyVersion,
      bodyHash: hashComplaintBody(current.sections),
      oldBlockIds: [],
      newBlockIds: current.managedBlockIds,
    };
  }

  const nextVersion =
    input.nextBodyVersion ??
    (sections.length > 0
      ? Math.max(...sections.map((s) => s.version)) + 1
      : 1);

  let newBlockIds: string[];
  if (
    current &&
    current.bodyVersion === nextVersion &&
    sectionsEqual(current.sections, input.sections)
  ) {
    newBlockIds = current.managedBlockIds;
  } else {
    const children = buildManagedComplaintBodyBlocks({
      sections: input.sections,
      bodyVersion: nextVersion,
    });
    for (let i = 0; i < children.length; i += APPEND_CHUNK) {
      const chunk = children.slice(i, i + APPEND_CHUNK);
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk as never,
      });
    }

    const afterAppend = await listAllChildBlocks(notion, pageId);
    const verified = extractManagedComplaintBody(afterAppend);
    if (
      !verified ||
      verified.bodyVersion !== nextVersion ||
      !sectionsEqual(verified.sections, input.sections)
    ) {
      throw new ComplaintSyncError(
        "notion_failed",
        "本文セクションの追加検証に失敗しました",
        {
          stage: "body_append_verify",
          expectedVersion: nextVersion,
        },
      );
    }
    newBlockIds = verified.managedBlockIds;
  }

  const previousManagedIds = collectAllManagedBlockIds(beforeBlocks);
  const oldBlockIds = previousManagedIds.filter(
    (id) => !newBlockIds.includes(id),
  );

  for (const blockId of oldBlockIds) {
    try {
      await notion.blocks.delete({ block_id: blockId });
    } catch {
      // 既削除は許容。未マーク手動ブロックは対象外。
    }
  }

  return {
    bodyVersion: nextVersion,
    bodyHash: hashComplaintBody(input.sections),
    oldBlockIds,
    newBlockIds,
  };
}

export type { NotionBlockLike };
