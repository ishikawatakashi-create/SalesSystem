import "server-only";

import { ORGANIZATION_RELATIONSHIP_MASTER_TYPE } from "@/lib/organizations/relationship";

/** relationship page IDs → semantic_key[]（順序安定・重複除去） */
export async function resolveRelationshipSemanticKeys(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from(table: string): any },
  relationshipPageIds: string[],
): Promise<string[]> {
  if (relationshipPageIds.length === 0) return [];
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id,semantic_key,master_type")
    .in("notion_page_id", relationshipPageIds);
  if (error) throw new Error(error.message);
  const byId = new Map(
    ((data ?? []) as Array<{
      notion_page_id: string;
      semantic_key: string | null;
      master_type: string;
    }>)
      .filter((r) => r.master_type === ORGANIZATION_RELATIONSHIP_MASTER_TYPE)
      .map((r) => [r.notion_page_id, r.semantic_key]),
  );
  const keys: string[] = [];
  for (const id of relationshipPageIds) {
    const key = byId.get(id);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** semantic_key → masters_cache page id（関係性） */
export async function findRelationshipMasterPageId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from(table: string): any },
  semanticKey: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", ORGANIZATION_RELATIONSHIP_MASTER_TYPE)
    .eq("semantic_key", semanticKey)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.notion_page_id as string | undefined) ?? null;
}

/** semantic_key[] → masters_cache page ids（関係性・入力順・重複除去） */
export async function resolveRelationshipPageIdsBySemanticKeys(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from(table: string): any },
  semanticKeys: string[],
): Promise<string[]> {
  const keys = [...new Set(semanticKeys.map((k) => k.trim()).filter(Boolean))];
  if (keys.length === 0) return [];
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id,semantic_key")
    .eq("master_type", ORGANIZATION_RELATIONSHIP_MASTER_TYPE)
    .eq("is_active", true)
    .in("semantic_key", keys);
  if (error) throw new Error(error.message);
  const byKey = new Map(
    ((data ?? []) as Array<{ notion_page_id: string; semantic_key: string | null }>)
      .filter((r) => r.semantic_key)
      .map((r) => [r.semantic_key as string, r.notion_page_id]),
  );
  const pageIds: string[] = [];
  for (const key of keys) {
    const id = byKey.get(key);
    if (id && !pageIds.includes(id)) pageIds.push(id);
  }
  return pageIds;
}
