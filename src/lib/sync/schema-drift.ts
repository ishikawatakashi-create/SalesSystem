import "server-only";

import type { Client } from "@notionhq/client";

import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import {
  loadDataSourceEnvMap,
  type SyncEntityKey,
} from "@/lib/sync/ds-routing";
import { createAdminClient } from "@/lib/supabase/admin";

export type SchemaPropertyMeta = {
  id: string;
  name: string;
  type: string;
};

export type SchemaDriftFinding = {
  entity: SyncEntityKey;
  dataSourceId: string;
  kind:
    | "missing_in_live"
    | "missing_in_snapshot"
    | "type_changed"
    | "snapshot_missing"
    | "live_fetch_failed";
  propertyName?: string;
  snapshotType?: string;
  liveType?: string;
  message: string;
};

type SnapshotShape = {
  databases?: Record<
    string,
    {
      dataSourceId?: string;
      properties?: Record<string, { id: string; name: string; type: string }>;
    }
  >;
};

async function loadSnapshot(
  admin = createAdminClient(),
): Promise<SnapshotShape | null> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as SnapshotShape | null) ?? null;
}

async function fetchLiveProperties(
  notion: Client,
  dataSourceId: string,
): Promise<Record<string, SchemaPropertyMeta>> {
  const ds = (await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  } as never)) as {
    properties?: Record<string, { id?: string; name?: string; type?: string }>;
  };
  const out: Record<string, SchemaPropertyMeta> = {};
  for (const [name, meta] of Object.entries(ds.properties ?? {})) {
    if (!meta?.id || !meta.type) continue;
    out[name] = { id: meta.id, name: meta.name ?? name, type: meta.type };
  }
  return out;
}

/**
 * スナップショットと live data source スキーマを照合する。
 * 不一致は findings として返し、呼び出し側で sync_errors へ記録する。
 */
export async function detectSchemaDrift(input: {
  notion: Client;
  entities?: SyncEntityKey[];
  admin?: ReturnType<typeof createAdminClient>;
}): Promise<SchemaDriftFinding[]> {
  const admin = input.admin ?? createAdminClient();
  const envMap = loadDataSourceEnvMap();
  const snapshot = await loadSnapshot(admin);
  const entities =
    input.entities ??
    (Object.keys(envMap) as SyncEntityKey[]).filter((k) => envMap[k]);

  const findings: SchemaDriftFinding[] = [];

  for (const entity of entities) {
    const dataSourceId = envMap[entity];
    if (!dataSourceId) continue;

    const snapProps = snapshot?.databases?.[entity]?.properties;
    if (!snapProps) {
      findings.push({
        entity,
        dataSourceId,
        kind: "snapshot_missing",
        message: `snapshot missing for ${entity}`,
      });
      continue;
    }

    let liveProps: Record<string, SchemaPropertyMeta>;
    try {
      liveProps = await fetchLiveProperties(input.notion, dataSourceId);
    } catch {
      findings.push({
        entity,
        dataSourceId,
        kind: "live_fetch_failed",
        message: `live schema fetch failed for ${entity}`,
      });
      continue;
    }

    const snapById = new Map(
      Object.values(snapProps).map((p) => [p.id, p] as const),
    );
    const liveById = new Map(
      Object.values(liveProps).map((p) => [p.id, p] as const),
    );

    for (const [id, snap] of snapById) {
      const live = liveById.get(id);
      if (!live) {
        findings.push({
          entity,
          dataSourceId,
          kind: "missing_in_live",
          propertyName: snap.name,
          snapshotType: snap.type,
          message: `property removed or hidden: ${snap.name}`,
        });
        continue;
      }
      if (live.type !== snap.type) {
        findings.push({
          entity,
          dataSourceId,
          kind: "type_changed",
          propertyName: snap.name,
          snapshotType: snap.type,
          liveType: live.type,
          message: `property type changed: ${snap.name}`,
        });
      }
    }

    for (const [id, live] of liveById) {
      if (!snapById.has(id)) {
        findings.push({
          entity,
          dataSourceId,
          kind: "missing_in_snapshot",
          propertyName: live.name,
          liveType: live.type,
          message: `new property not in snapshot: ${live.name}`,
        });
      }
    }
  }

  return findings;
}

/** findings を sync_errors(stage=schema_mismatch) へ記録 */
export async function recordSchemaDriftFindings(input: {
  findings: SchemaDriftFinding[];
  admin?: ReturnType<typeof createAdminClient>;
  source?: string;
}): Promise<number> {
  if (input.findings.length === 0) return 0;
  const admin = input.admin ?? createAdminClient();
  let inserted = 0;
  for (const finding of input.findings) {
    const { error } = await admin.from("sync_errors").insert({
      stage: "schema_mismatch",
      entity_type: finding.entity,
      notion_page_id: null,
      external_id: null,
      message: finding.message,
      detail: {
        kind: finding.kind,
        dataSourceId: finding.dataSourceId,
        propertyName: finding.propertyName ?? null,
        snapshotType: finding.snapshotType ?? null,
        liveType: finding.liveType ?? null,
        source: input.source ?? "schema_drift",
      },
    } as never);
    if (!error) inserted += 1;
  }
  return inserted;
}
