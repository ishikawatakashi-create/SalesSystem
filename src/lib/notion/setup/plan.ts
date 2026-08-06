import {
  assertAllHaveExternalId,
  DATABASES,
  RELATION_PHASE_ORDER,
  type NotionDbKey,
} from "@/lib/notion/schema/databases";
import {
  assertSemanticKeyUniqueness,
  INITIAL_MASTERS,
  masterExternalId,
  semanticTagsAllowOverlap,
} from "@/lib/notion/schema/masters";
import { STANDARD_VIEWS } from "@/lib/notion/schema/views";

export type SetupPlan = {
  mode: "plan" | "apply";
  parentPageId: string | null;
  phases: {
    a: {
      databases: Array<{
        key: NotionDbKey;
        title: string;
        properties: string[];
      }>;
    };
    b: {
      order: NotionDbKey[];
      relations: Array<{
        database: string;
        property: string;
        target: string;
        single?: boolean;
        dual?: boolean;
      }>;
    };
    c: {
      masters: Array<{
        masterType: string;
        name: string;
        externalId: string;
        semanticKey?: string;
        semanticTags?: string[];
      }>;
      views: Array<{
        name: string;
        database: string;
        type: string;
        filterSummary: string;
        sortSummary: string;
        manualSetupNotes?: string[];
      }>;
      snapshot: {
        targets: string[];
        localPath: string;
        systemSettingsKey: string;
      };
    };
  };
  safety: string[];
};

/**
 * Notionへ変更を加えないplanを構築する。
 */
export function buildSetupPlan(input: {
  apply: boolean;
  parentPageId: string | null;
}): SetupPlan {
  assertAllHaveExternalId();
  assertSemanticKeyUniqueness();
  void semanticTagsAllowOverlap();

  const relations: SetupPlan["phases"]["b"]["relations"] = [];
  for (const key of RELATION_PHASE_ORDER) {
    const db = DATABASES.find((d) => d.key === key)!;
    for (const prop of db.phaseBRelations) {
      if (prop.type !== "relation") continue;
      relations.push({
        database: db.title,
        property: prop.name,
        target: DATABASES.find((d) => d.key === prop.target)!.title,
        single: prop.single,
        dual: prop.dual,
      });
    }
  }

  return {
    mode: input.apply ? "apply" : "plan",
    parentPageId: input.parentPageId,
    phases: {
      a: {
        databases: DATABASES.map((db) => ({
          key: db.key,
          title: db.title,
          properties: db.phaseAProperties.map((p) => `${p.name}:${p.type}`),
        })),
      },
      b: {
        order: [...RELATION_PHASE_ORDER],
        relations,
      },
      c: {
        masters: INITIAL_MASTERS.map((m) => ({
          masterType: m.masterType,
          name: m.name,
          externalId: masterExternalId(m),
          semanticKey: m.semanticKey,
          semanticTags: m.semanticTags,
        })),
        views: STANDARD_VIEWS.map((v) => ({
          name: v.name,
          database: DATABASES.find((d) => d.key === v.databaseKey)!.title,
          type: v.type,
          filterSummary: v.filterSummary,
          sortSummary: v.sortSummary,
          manualSetupNotes: v.manualSetupNotes,
        })),
        snapshot: {
          targets: DATABASES.map((d) => d.title),
          localPath: "config/notion-schema.generated.json",
          systemSettingsKey: "notion_schema_snapshot",
        },
      },
    },
    safety: [
      "既定はplanのみ。Notionへ変更しない",
      "--apply 明示時のみ実変更",
      "同名DBの自動再利用をしない",
      "--reset / 破壊的削除は未実装",
      "トークンを出力しない",
      "parent page IDをソースにハードコードしない",
      "既存Notionデータを削除・上書きしない",
    ],
  };
}

export function formatSetupPlan(plan: SetupPlan): string {
  const lines: string[] = [];
  lines.push(`# Notion setup (${plan.mode})`);
  lines.push(`parent_page_id: ${plan.parentPageId ? "[provided]" : "[missing]"}`);
  lines.push("");
  lines.push("## Safety");
  for (const s of plan.safety) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Phase A databases");
  for (const db of plan.phases.a.databases) {
    lines.push(`### ${db.title} (${db.key})`);
    lines.push(`properties: ${db.properties.join(", ")}`);
  }
  lines.push("");
  lines.push("## Phase B relation order");
  lines.push(plan.phases.b.order.join(" -> "));
  for (const r of plan.phases.b.relations) {
    lines.push(
      `- ${r.database}.${r.property} -> ${r.target}` +
        (r.single ? " [single]" : "") +
        (r.dual ? " [dual]" : ""),
    );
  }
  lines.push("");
  lines.push(`## Phase C masters (${plan.phases.c.masters.length})`);
  for (const m of plan.phases.c.masters) {
    lines.push(
      `- [${m.masterType}] ${m.name} ext=${m.externalId}` +
        (m.semanticKey ? ` key=${m.semanticKey}` : "") +
        (m.semanticTags ? ` tags=${m.semanticTags.join(",")}` : ""),
    );
  }
  lines.push("");
  lines.push("## Phase C views");
  for (const v of plan.phases.c.views) {
    lines.push(`- ${v.name} @ ${v.database} (${v.type})`);
    lines.push(`  filter: ${v.filterSummary}`);
    lines.push(`  sort: ${v.sortSummary}`);
    for (const note of v.manualSetupNotes ?? []) {
      lines.push(`  MANUAL: ${note}`);
    }
  }
  lines.push("");
  lines.push("## Snapshot");
  lines.push(`- local: ${plan.phases.c.snapshot.localPath}`);
  lines.push(`- system_settings.key: ${plan.phases.c.snapshot.systemSettingsKey}`);
  if (plan.mode === "plan") {
    lines.push("");
    lines.push("No Notion mutations were performed.");
  }
  return lines.join("\n");
}
