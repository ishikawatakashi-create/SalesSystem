"use server";

import { AuthError } from "@/lib/auth/require";
import { globalSearch } from "@/lib/search/global-search";
import type { GlobalSearchResult } from "@/lib/search/types";

export type SearchGlobalActionResult =
  | { ok: true; result: GlobalSearchResult }
  | { ok: false; message: string };

export async function searchGlobalAction(input: {
  q: string;
  limitPerEntity?: number;
}): Promise<SearchGlobalActionResult> {
  try {
    const result = await globalSearch(input.q ?? "", {
      limitPerEntity: input.limitPerEntity,
    });
    return { ok: true, result };
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: "検索に失敗しました。時間をおいて再度お試しください",
    };
  }
}
