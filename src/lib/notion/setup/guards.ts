import type { Client } from "@notionhq/client";

import { DATABASES } from "@/lib/notion/schema/databases";
import type { SetupState } from "@/lib/notion/setup/apply";

/**
 * 親ページ直下の生存中(in_trash=false)の同名DBを検出する。
 * ゴミ箱内は無視する。同名があっても state に同一 database_id があれば再開対象として許容。
 */
export async function findConflictingLiveDatabases(input: {
  client: Client;
  parentPageId: string;
  state: SetupState | null;
}): Promise<Array<{ title: string; databaseId: string }>> {
  const expectedTitles = new Set(DATABASES.map((d) => d.title));
  const knownIds = new Set(
    Object.values(input.state?.databases ?? {})
      .map((d) => d.databaseId)
      .filter((id): id is string => Boolean(id)),
  );

  const conflicts: Array<{ title: string; databaseId: string }> = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await input.client.blocks.children.list({
      block_id: input.parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of page.results) {
      const b = block as { id: string; type?: string };
      if (b.type !== "child_database") continue;

      const db = (await input.client.databases.retrieve({
        database_id: b.id,
      })) as {
        id: string;
        in_trash?: boolean;
        title?: Array<{ plain_text?: string }>;
      };

      if (db.in_trash) continue;

      const title =
        db.title?.map((t) => t.plain_text ?? "").join("").trim() ?? "";
      if (!expectedTitles.has(title)) continue;
      if (knownIds.has(db.id)) continue;

      conflicts.push({ title, databaseId: db.id });
    }

    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  return conflicts;
}

export async function assertParentPageReady(input: {
  client: Client;
  parentPageId: string;
}): Promise<void> {
  const page = (await input.client.pages.retrieve({
    page_id: input.parentPageId,
  })) as { in_trash?: boolean; object?: string };

  if (page.in_trash) {
    throw new Error("親ページが in_trash=true です。setupを中止します");
  }
}
