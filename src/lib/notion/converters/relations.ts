/**
 * relationプロパティの25件超ページネーション取得。
 */

export type RelationPropertyValue = {
  id?: string;
  type?: string;
  relation?: Array<{ id: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

export type PagePropertyPager = {
  retrieve: (args: {
    page_id: string;
    property_id: string;
    start_cursor?: string;
  }) => Promise<RelationPropertyValue>;
};

/**
 * ページ取得レスポンスのrelationがhas_moreのとき、property endpointで全件取得する。
 * 件数や型の不正は黙って無視しない。
 */
export async function resolveRelationIds(input: {
  pageId: string;
  propertyId: string;
  value: RelationPropertyValue | undefined;
  pager: PagePropertyPager;
}): Promise<string[]> {
  if (!input.value) {
    throw new Error(`relationプロパティがありません: ${input.propertyId}`);
  }
  if (input.value.type && input.value.type !== "relation") {
    throw new Error(
      `型不一致: ${input.propertyId} は relation ではなく ${input.value.type}`,
    );
  }

  const ids = [...(input.value.relation ?? []).map((r) => r.id)];
  if (!input.value.has_more) return ids;

  let cursor: string | null | undefined = input.value.next_cursor ?? undefined;
  for (;;) {
    const page = await input.pager.retrieve({
      page_id: input.pageId,
      property_id: input.propertyId,
      start_cursor: cursor ?? undefined,
    });
    if (page.type && page.type !== "relation") {
      throw new Error(`型不一致(ページネーション): ${input.propertyId}`);
    }
    for (const rel of page.relation ?? []) {
      if (!rel.id) throw new Error("relation要素にidがありません");
      ids.push(rel.id);
    }
    if (!page.has_more) break;
    cursor = page.next_cursor;
    if (!cursor) {
      throw new Error(`has_moreなのにnext_cursorがありません: ${input.propertyId}`);
    }
  }
  return ids;
}
