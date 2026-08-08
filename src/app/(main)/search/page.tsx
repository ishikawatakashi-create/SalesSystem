import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/ui/state-messages";
import { RelationshipBadges } from "@/features/organizations/relationship-badges";
import { AuthError } from "@/lib/auth/require";
import { globalSearch } from "@/lib/search/global-search";
import {
  SEARCH_ENTITIES,
  SEARCH_ENTITY_LABELS,
  type SearchEntity,
} from "@/lib/search/types";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = await searchParams;
  const q = str(params, "q") ?? "";
  const entityRaw = str(params, "entity");
  const entityFilter =
    entityRaw && SEARCH_ENTITIES.includes(entityRaw as SearchEntity)
      ? (entityRaw as SearchEntity)
      : null;

  let result;
  try {
    result = await globalSearch(q, { limitPerEntity: 20 });
  } catch (e) {
    if (e instanceof AuthError && e.code === "unauthenticated") {
      redirect("/login");
    }
    throw e;
  }

  const groups = entityFilter
    ? result.groups.filter((g) => g.entity === entityFilter)
    : result.groups;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900">検索結果</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {q
              ? `「${q}」 / ${result.totalCount}件(各最大20件)`
              : "キーワードを入力してください"}
          </p>
        </div>
        <form action="/search" method="get" className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="検索キーワード"
            className="w-64 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
          >
            検索
          </button>
        </form>
      </div>

      <div className="mb-3 flex flex-wrap gap-1 text-xs">
        <TabLink q={q} entity={null} active={!entityFilter} label="すべて" />
        {SEARCH_ENTITIES.map((entity) => (
          <TabLink
            key={entity}
            q={q}
            entity={entity}
            active={entityFilter === entity}
            label={SEARCH_ENTITY_LABELS[entity]}
          />
        ))}
      </div>

      {!q && (
        <EmptyState
          title="キーワードを入力してください"
          hint="上部の検索欄、またはヘッダーの検索ボックスから検索できます。"
        />
      )}

      {q && result.totalCount === 0 && (
        <EmptyState
          title="該当する結果がありません"
          hint="キーワードを変えて再検索してください。"
        />
      )}

      {q &&
        result.totalCount > 0 &&
        groups.map((group) => (
          <section key={group.entity} className="mb-4">
            <h2 className="mb-1.5 text-sm font-semibold text-slate-800">
              {group.label}
              <span className="ml-1 text-xs font-normal text-slate-500">
                ({group.hits.length})
              </span>
            </h2>
            {group.hits.length === 0 ? (
              <EmptyState title="該当なし" />
            ) : (
              <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-xs">
                {group.hits.map((hit) => (
                  <li key={`${hit.entity}-${hit.pageId}`}>
                    <Link
                      href={hit.href}
                      className="flex flex-col px-3 py-2 hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">
                        {hit.title}
                        {hit.isArchived && (
                          <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                            アーカイブ
                          </span>
                        )}
                      </span>
                      {hit.relationshipSemanticKeys &&
                        hit.relationshipSemanticKeys.length > 0 && (
                          <span className="mt-0.5">
                            <RelationshipBadges
                              keys={hit.relationshipSemanticKeys}
                              empty={null}
                            />
                          </span>
                        )}
                      {hit.subtitle && (
                        <span className="text-[11px] text-slate-500">
                          {hit.subtitle}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}

function TabLink({
  q,
  entity,
  active,
  label,
}: {
  q: string;
  entity: SearchEntity | null;
  active: boolean;
  label: string;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (entity) params.set("entity", entity);
  const href = `/search${params.toString() ? `?${params}` : ""}`;
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-1 ${
        active
          ? "border-slate-700 bg-slate-700 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}
