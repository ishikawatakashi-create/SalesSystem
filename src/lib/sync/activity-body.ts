/**
 * 対応履歴ページ本文の append → verify → delete ヘルパー。
 * 未マークの手動ブロックは削除しない。
 */

import type { Client } from "@notionhq/client";

import {
  buildManagedActivityBodyBlocks,
  collectAllManagedBlockIds,
  extractManagedBody,
  findManagedSections,
  hashActivityBody,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";
import { ActivitySyncError } from "@/lib/sync/errors";

const APPEND_CHUNK = 100;

export type ActivityBodyReplaceResult = {
  bodyVersion: number;
  bodyHash: string;
  oldBlockIds: string[];
  newBlockIds: string[];
};

export async function listAllChildBlocks(
  notion: Client,
  pageId: string,
): Promise<NotionBlockLike[]> {
  const blocks: NotionBlockLike[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results) {
      if ("type" in block && "id" in block) {
        blocks.push(block as NotionBlockLike);
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return blocks;
}

/**
 * 管理セクションを追加し、期待 version の存在を検証してから旧管理ブロックのみ削除する。
 */
export async function replaceManagedActivityBody(input: {
  notion: Client;
  pageId: string;
  body: string;
  /** 新規セクションの version。省略時は既存最大+1(無ければ1) */
  nextBodyVersion?: number;
  /** true のとき、旧本文が期待されるのに管理セクションが無いと throw */
  oldContentExpected?: boolean;
}): Promise<ActivityBodyReplaceResult> {
  const { notion, pageId } = input;
  const beforeBlocks = await listAllChildBlocks(notion, pageId);
  const sections = findManagedSections(beforeBlocks);
  const current = extractManagedBody(beforeBlocks);

  if (
    input.oldContentExpected &&
    !current &&
    beforeBlocks.length > 0 &&
    sections.length === 0
  ) {
    // ブロックはあるがマーカーが無い → 安全のため全削除しない
    throw new ActivitySyncError(
      "ambiguous_write",
      "管理セクションを識別できないため本文を更新できません",
      { stage: "body_managed_section_missing" },
    );
  }

  if (
    current &&
    current.body === input.body &&
    hashActivityBody(current.body) === hashActivityBody(input.body)
  ) {
    return {
      bodyVersion: current.bodyVersion,
      bodyHash: hashActivityBody(current.body),
      oldBlockIds: [],
      newBlockIds: current.managedBlockIds,
    };
  }

  const nextVersion =
    input.nextBodyVersion ??
    (sections.length > 0
      ? Math.max(...sections.map((s) => s.version)) + 1
      : 1);

  // 既に同 version が検証済みなら削除ステップのみ
  const already = sections.find((s) => s.version === nextVersion);
  let newBlockIds: string[];
  if (already && already.bodyText === input.body) {
    newBlockIds = already.blockIds;
  } else {
    const children = buildManagedActivityBodyBlocks({
      body: input.body,
      bodyVersion: nextVersion,
    });
    const createdIds: string[] = [];
    for (let i = 0; i < children.length; i += APPEND_CHUNK) {
      const chunk = children.slice(i, i + APPEND_CHUNK);
      const appended = await notion.blocks.children.append({
        block_id: pageId,
        children: chunk as never,
      });
      for (const block of appended.results) {
        if ("id" in block) createdIds.push(block.id);
      }
    }

    const afterAppend = await listAllChildBlocks(notion, pageId);
    const verified = findManagedSections(afterAppend).find(
      (s) => s.version === nextVersion,
    );
    if (!verified || verified.bodyText !== input.body) {
      throw new ActivitySyncError(
        "notion_failed",
        "本文セクションの追加検証に失敗しました",
        {
          stage: "body_append_verify",
          expectedVersion: nextVersion,
        },
      );
    }
    newBlockIds = verified.blockIds;
  }

  // 削除対象は更新前に認識していた管理ブロックのみ(後続の手動ブロックを巻き込まない)
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
    bodyHash: hashActivityBody(input.body),
    oldBlockIds,
    newBlockIds,
  };
}
