import { describe, expect, it } from "vitest";

import {
  assertAllHaveExternalId,
  DATABASES,
  RELATION_PHASE_ORDER,
} from "@/lib/notion/schema/databases";
import {
  assertSemanticKeyUniqueness,
  INITIAL_MASTERS,
  masterExternalId,
  semanticTagsAllowOverlap,
} from "@/lib/notion/schema/masters";
import { STANDARD_VIEWS } from "@/lib/notion/schema/views";
import { buildSetupPlan, formatSetupPlan } from "@/lib/notion/setup/plan";
import { emptySetupState } from "@/lib/notion/setup/apply";

describe("Notion 9DBスキーマ契約", () => {
  it("9DBを定義し全DBにexternal_idがある", () => {
    expect(DATABASES).toHaveLength(9);
    assertAllHaveExternalId();
  });

  it("relation作成順序が定義されている", () => {
    expect(RELATION_PHASE_ORDER).toEqual([
      "masters",
      "staff",
      "customers",
      "contacts",
      "deals",
      "activities",
      "contracts",
      "complaints",
      "actions",
    ]);
  });

  it("初期マスタのexternal_idは決定的で冪等", () => {
    const a = masterExternalId(INITIAL_MASTERS[0]!);
    const b = masterExternalId(INITIAL_MASTERS[0]!);
    expect(a).toBe(b);
  });

  it("semantic_keyは種別内一意、semantic_tagsは重複許容", () => {
    expect(() => assertSemanticKeyUniqueness()).not.toThrow();
    expect(semanticTagsAllowOverlap()).toBe(true);
  });

  it("標準ビューを定義し、API不能項目はmanual注記を持つ", () => {
    expect(STANDARD_VIEWS.length).toBeGreaterThanOrEqual(7);
    expect(
      STANDARD_VIEWS.some((v) => (v.manualSetupNotes?.length ?? 0) > 0),
    ).toBe(true);
  });

  it("planモードはapply=falseで外部変更を行わない記述を含む", () => {
    const plan = buildSetupPlan({ apply: false, parentPageId: null });
    expect(plan.mode).toBe("plan");
    const text = formatSetupPlan(plan);
    expect(text).toContain("No Notion mutations were performed.");
    expect(text).not.toContain("ntn_");
    expect(text).not.toContain("secret_");
  });

  it("--applyなしでは作成不可(plan.mode)", () => {
    const plan = buildSetupPlan({ apply: false, parentPageId: "page" });
    expect(plan.mode).toBe("plan");
    const applyPlan = buildSetupPlan({ apply: true, parentPageId: "page" });
    expect(applyPlan.mode).toBe("apply");
  });

  it("部分実行再開用のsetup状態を空から構築できる", () => {
    const state = emptySetupState("parent");
    expect(state.phase).toBe("a");
    expect(state.databases.customers.title).toBe("顧客アカウント");
    expect(state.mastersSeeded).toBe(false);
  });

  it("スナップショット形式のキーをplanが示す", () => {
    const plan = buildSetupPlan({ apply: false, parentPageId: null });
    expect(plan.phases.c.snapshot.localPath).toBe(
      "config/notion-schema.generated.json",
    );
    expect(plan.phases.c.snapshot.systemSettingsKey).toBe(
      "notion_schema_snapshot",
    );
  });
});
