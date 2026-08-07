/**
 * CSVアップロード後の検証・staging。
 * raw CSV全文や個人情報をerror_messageへ保存しない。
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decodeCsvBuffer } from "@/lib/csv/encoding";
import { parseCsv } from "@/lib/csv/parser";
import { downloadImportObject } from "@/lib/csv/storage";
import { ENTITY_FIELDS } from "@/lib/csv/aliases";
import { validateMapping } from "@/lib/csv/mapping";
import {
  buildSourceKey,
  deterministicExternalId,
  hashSourceKey,
} from "@/lib/csv/source-key";
import { resolveMasterByDisplayName } from "@/lib/csv/master-resolve";
import { detectDuplicateCustomers } from "@/lib/csv/duplicate-detector";
import { assertTransition, type ImportJobStatus } from "@/lib/csv/state-machine";
import { CSV_MAX_BODY_CHARS } from "@/lib/csv/limits";
import type { ImportEntity } from "@/lib/csv/entities";
import { uuidV5 } from "@/lib/notion/ids";

type Admin = ReturnType<typeof createAdminClient>;

function splitMulti(value: string | undefined | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[|;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(value: string | undefined | null): boolean | null {
  if (value == null || value.trim() === "") return null;
  const v = value.trim().normalize("NFKC").toLowerCase();
  if (["1", "true", "yes", "y", "はい", "有効"].includes(v)) return true;
  if (["0", "false", "no", "n", "いいえ", "無効"].includes(v)) return false;
  return null;
}

function parseNumber(value: string | undefined | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

async function loadMasters(admin: Admin) {
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id,name,master_type,is_active,semantic_key")
    .eq("is_active", true)
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    notion_page_id: string;
    name: string;
    master_type: string;
    is_active: boolean;
    semantic_key: string | null;
  }>;
}

async function resolveCustomerPageId(
  admin: Admin,
  sourceKey: string | null,
  sourceSystem: string,
): Promise<{ pageId: string | null; code?: string }> {
  if (!sourceKey) return { pageId: null, code: "relation_unresolved" };

  // prior import_rows by source key
  const { data: prior } = await admin
    .from("import_rows")
    .select("notion_page_id")
    .eq("source_key_hash", hashSourceKey(sourceKey))
    .eq("status", "imported")
    .not("notion_page_id", "is", null)
    .limit(2);
  if ((prior?.length ?? 0) > 1) return { pageId: null, code: "relation_ambiguous" };
  if (prior?.[0]?.notion_page_id) {
    return { pageId: prior[0].notion_page_id as string };
  }

  // external_id exact if source key looks like uuid
  const externalCandidate = deterministicExternalId(
    "00000000-0000-0000-0000-000000000000",
    0,
    sourceKey,
  );
  const { data: byExt } = await admin
    .from("customer_index")
    .select("notion_page_id")
    .eq("external_id", externalCandidate)
    .limit(2);
  if ((byExt?.length ?? 0) === 1) {
    return { pageId: byExt![0]!.notion_page_id as string };
  }

  // also try uuidV5 of raw sourceRecordId only
  const rawId = sourceKey.split(":").pop() ?? sourceKey;
  const { data: byRaw } = await admin
    .from("customer_index")
    .select("notion_page_id")
    .eq("external_id", uuidV5(`csv:${sourceSystem}:${rawId}`))
    .limit(2);
  if ((byRaw?.length ?? 0) === 1) {
    return { pageId: byRaw![0]!.notion_page_id as string };
  }
  if ((byRaw?.length ?? 0) > 1) return { pageId: null, code: "relation_ambiguous" };

  return { pageId: null, code: "relation_unresolved" };
}

async function resolveByExternalOnTable(
  admin: Admin,
  table: string,
  sourceKey: string | null,
  sourceSystem: string,
): Promise<{ pageId: string | null; code?: string }> {
  if (!sourceKey) return { pageId: null, code: "relation_unresolved" };
  const { data: prior } = await admin
    .from("import_rows")
    .select("notion_page_id")
    .eq("source_key_hash", hashSourceKey(sourceKey))
    .eq("status", "imported")
    .not("notion_page_id", "is", null)
    .limit(2);
  if ((prior?.length ?? 0) > 1) return { pageId: null, code: "relation_ambiguous" };
  if (prior?.[0]?.notion_page_id) {
    return { pageId: prior[0].notion_page_id as string };
  }
  const rawId = sourceKey.includes(":")
    ? (sourceKey.split(":").pop() ?? sourceKey)
    : sourceKey;
  const ext = uuidV5(`csv:${sourceSystem}:${rawId}`);
  const { data } = await admin
    .from(table)
    .select("notion_page_id")
    .eq("external_id", ext)
    .limit(2);
  const rows = (data ?? []) as Array<{ notion_page_id: string }>;
  if (rows.length === 1) return { pageId: rows[0]!.notion_page_id };
  if (rows.length > 1) return { pageId: null, code: "relation_ambiguous" };
  return { pageId: null, code: "relation_unresolved" };
}

export async function validateAndStageImport(input: {
  importJobId: string;
  actorId: string;
  actorName: string;
}): Promise<{ ok: boolean; summary: Record<string, number> }> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", input.importJobId)
    .maybeSingle();
  if (error || !job) throw new Error("import_job_not_found");

  const entity = job.entity_type as ImportEntity;
  if (!entity) throw new Error("entity_type_missing");
  const mapping = (job.column_mapping ?? {}) as Record<string, string | null>;
  const mapCheck = validateMapping(mapping, entity);
  // unsupported mapped fields become warnings, not hard fail for mapping_required→validate
  const hardErrors = mapCheck.errors.filter((e) => e.code !== "unsupported_field");
  if (hardErrors.length > 0) {
    await admin
      .from("import_jobs")
      .update({
        status: "failed",
        summary: { mappingErrors: hardErrors.map((e) => e.code) },
      })
      .eq("id", input.importJobId);
    return { ok: false, summary: { mapping_errors: hardErrors.length } };
  }

  assertTransition(
    String(job.status) as ImportJobStatus,
    "validating",
  );
  await admin
    .from("import_jobs")
    .update({ status: "validating" })
    .eq("id", input.importJobId);

  const buf = await downloadImportObject(String(job.storage_path));
  const encoding = (job.detected_encoding as "utf-8" | "cp932" | "auto" | undefined) ?? "auto";
  const { text, encoding: usedEnc } = decodeCsvBuffer(buf, encoding === "auto" ? "auto" : encoding);
  const parsed = parseCsv(text);
  const masters = await loadMasters(admin);
  const sourceSystem = String(job.source_system ?? "csv");

  // clear previous rows
  await admin.from("import_rows").delete().eq("import_job_id", input.importJobId);

  const counters = {
    total: 0,
    valid: 0,
    warning: 0,
    error: 0,
    valid_new: 0,
    valid_update: 0,
    duplicate: 0,
    skipped: 0,
    relation_unresolved: 0,
  };

  const fieldByKey = new Map(ENTITY_FIELDS[entity].map((f) => [f.key, f]));
  const inverse: Record<string, string> = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (key) inverse[key] = header;
  }

  const rowInserts: Record<string, unknown>[] = [];

  for (let i = 0; i < parsed.rows.length; i += 1) {
    const cells = parsed.rows[i]!;
    const rowNumber = parsed.rowNumbers[i] ?? i + 2;
    counters.total += 1;
    const reasonCodes: Array<{ field?: string; code: string }> = [];
    const mapped: Record<string, string> = {};
    for (const [header, key] of Object.entries(mapping)) {
      if (!key) continue;
      const col = parsed.headers.indexOf(header);
      if (col < 0) continue;
      const field = fieldByKey.get(key);
      if (field?.kind === "unsupported") {
        reasonCodes.push({ field: key, code: "unsupported_field" });
        continue;
      }
      mapped[key] = cells[col] ?? "";
    }

    const sourceRecordId = mapped.sourceRecordId?.trim() || null;
    const sourceKey = sourceRecordId
      ? buildSourceKey({ sourceSystem, sourceRecordId })
      : null;
    const externalId = deterministicExternalId(
      input.importJobId,
      rowNumber,
      sourceKey ?? undefined,
    );

    const staged: Record<string, unknown> = {
      externalId,
    };

    // masters
    for (const field of ENTITY_FIELDS[entity]) {
      if (field.kind !== "master" || !field.masterType) continue;
      const raw = mapped[field.key];
      if (!raw?.trim()) continue;
      const names = splitMulti(raw);
      const pageIds: string[] = [];
      for (const name of names) {
        const resolved = resolveMasterByDisplayName({
          masters,
          masterType: field.masterType,
          displayName: name,
        });
        if ("error" in resolved) {
          reasonCodes.push({
            field: field.key,
            code: `master_${resolved.error}`,
          });
        } else {
          pageIds.push(resolved.pageId);
        }
      }
      if (field.key.endsWith("Names") || field.key.endsWith("PageIds")) {
        staged[field.key.replace(/Names$/, "PageIds")] = pageIds;
      } else if (field.key.endsWith("Name")) {
        staged[field.key.replace(/Name$/, "PageId")] = pageIds[0] ?? null;
      }
    }

    // relations
    if (mapped.customerSourceKey) {
      const custKey = buildSourceKey({
        sourceSystem,
        sourceRecordId: mapped.customerSourceKey.trim(),
      });
      const rel = await resolveCustomerPageId(admin, custKey, sourceSystem);
      if (!rel.pageId) {
        reasonCodes.push({
          field: "customerSourceKey",
          code: rel.code ?? "relation_unresolved",
        });
        counters.relation_unresolved += 1;
      } else {
        staged.customerPageId = rel.pageId;
      }
    }
    if (mapped.dealSourceKey) {
      const dealKey = buildSourceKey({
        sourceSystem,
        sourceRecordId: mapped.dealSourceKey.trim(),
      });
      const rel = await resolveByExternalOnTable(
        admin,
        "deal_index",
        dealKey,
        sourceSystem,
      );
      if (!rel.pageId) {
        reasonCodes.push({
          field: "dealSourceKey",
          code: rel.code ?? "relation_unresolved",
        });
      } else {
        staged.dealPageId = rel.pageId;
      }
    }
    if (mapped.contactSourceKeys) {
      const ids: string[] = [];
      for (const part of splitMulti(mapped.contactSourceKeys)) {
        const key = buildSourceKey({ sourceSystem, sourceRecordId: part });
        const rel = await resolveByExternalOnTable(
          admin,
          "contact_index",
          key,
          sourceSystem,
        );
        if (!rel.pageId) {
          reasonCodes.push({
            field: "contactSourceKeys",
            code: rel.code ?? "relation_unresolved",
          });
        } else {
          ids.push(rel.pageId);
        }
      }
      staged.contactPageIds = ids;
    }

    // scalar copy
    for (const field of ENTITY_FIELDS[entity]) {
      if (
        field.kind === "master" ||
        field.kind === "relation" ||
        field.kind === "unsupported" ||
        field.kind === "source_key"
      ) {
        continue;
      }
      const raw = mapped[field.key];
      if (raw == null || raw === "") continue;
      if (field.kind === "boolean") {
        const b = parseBool(raw);
        if (b == null) reasonCodes.push({ field: field.key, code: "invalid_boolean" });
        else staged[field.key] = b;
      } else if (field.kind === "number") {
        const n = parseNumber(raw);
        if (n == null) reasonCodes.push({ field: field.key, code: "invalid_number" });
        else staged[field.key] = n;
      } else if (field.kind === "body") {
        staged[field.key] = raw.slice(0, CSV_MAX_BODY_CHARS);
        if (raw.length > CSV_MAX_BODY_CHARS) {
          reasonCodes.push({ field: field.key, code: "body_truncated" });
        }
      } else {
        staged[field.key] = raw;
      }
    }

    // required text
    for (const field of ENTITY_FIELDS[entity]) {
      if (!field.required) continue;
      if (field.kind === "relation") {
        if (field.key === "customerSourceKey" && !staged.customerPageId) {
          reasonCodes.push({ field: field.key, code: "required_missing" });
        }
        continue;
      }
      if (field.kind === "source_key") continue;
      if (field.kind === "master") {
        const pageKey = field.key.replace(/Name$/, "PageId").replace(/Names$/, "PageIds");
        if (staged[pageKey] == null || staged[pageKey] === "") {
          // only if mapped
          if (mapped[field.key]?.trim()) {
            /* already errored */
          } else if (field.required) {
            reasonCodes.push({ field: field.key, code: "required_missing" });
          }
        }
        continue;
      }
      if (staged[field.key] == null || staged[field.key] === "") {
        reasonCodes.push({ field: field.key, code: "required_missing" });
      }
    }

    let status:
      | "invalid"
      | "valid_new"
      | "valid_update"
      | "duplicate"
      | "skipped" = "valid_new";
    let matchedPageId: string | null = null;
    const decision = (job.default_decision as string | null) ?? null;

    const hard = reasonCodes.filter(
      (r) =>
        r.code !== "unsupported_field" &&
        r.code !== "body_truncated",
    );
    if (hard.length > 0) {
      status = "invalid";
      counters.error += 1;
    } else {
      // existing by external_id
      const table =
        entity === "customers"
          ? "customer_index"
          : entity === "contacts"
            ? "contact_index"
            : entity === "deals"
              ? "deal_index"
              : entity === "activities"
                ? "activity_index"
                : entity === "actions"
                  ? "action_index"
                  : entity === "contracts"
                    ? "contract_index"
                    : "complaint_index";
      const { data: existing } = await admin
        .from(table)
        .select("notion_page_id")
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing?.notion_page_id) {
        matchedPageId = existing.notion_page_id as string;
        status = "valid_update";
        counters.valid_update += 1;
      } else if (entity === "customers") {
        const { data: idxRows } = await admin
          .from("customer_index")
          .select(
            "notion_page_id,display_name,legal_name,office_name,prefecture,phone,email",
          )
          .limit(5000);
        const candidates = detectDuplicateCustomers(
          {
            customerId: "incoming",
            legalName: String(staged.legalName ?? ""),
            officeName: String(staged.officeName ?? ""),
            prefecture: String(staged.prefecture ?? ""),
            phone: String(staged.phone ?? ""),
            displayName: String(staged.displayName ?? ""),
          },
          (idxRows ?? []).map((r) => ({
            customerId: r.notion_page_id as string,
            legalName: (r.legal_name as string) ?? "",
            officeName: (r.office_name as string) ?? "",
            prefecture: (r.prefecture as string) ?? "",
            phone: (r.phone as string) ?? "",
            displayName: (r.display_name as string) ?? "",
          })),
        );
        if (candidates.length > 0 && !decision) {
          status = "duplicate";
          matchedPageId = candidates[0]!.customerId;
          reasonCodes.push({ code: "duplicate_candidate" });
          counters.duplicate += 1;
        } else if (candidates.length > 0 && decision === "skip") {
          status = "skipped";
          counters.skipped += 1;
        } else if (candidates.length > 0 && decision === "update") {
          if (candidates.length > 1) {
            status = "invalid";
            reasonCodes.push({ code: "duplicate_ambiguous" });
            counters.error += 1;
          } else {
            status = "valid_update";
            matchedPageId = candidates[0]!.customerId;
            counters.valid_update += 1;
          }
        } else {
          counters.valid_new += 1;
        }
      } else {
        counters.valid_new += 1;
      }
      if (status !== "invalid") counters.valid += 1;
      if (reasonCodes.some((r) => r.code === "unsupported_field")) {
        counters.warning += 1;
      }
    }

    rowInserts.push({
      import_job_id: input.importJobId,
      row_number: rowNumber,
      external_id: externalId,
      status,
      source_key: sourceKey,
      source_key_hash: sourceKey ? hashSourceKey(sourceKey) : null,
      reason_codes: reasonCodes,
      decision:
        status === "valid_update"
          ? "update"
          : status === "skipped"
            ? "skip"
            : status === "valid_new"
              ? "create"
              : decision,
      matched_page_id: matchedPageId,
      notion_page_id: matchedPageId,
      staged,
      raw: null,
      error_message:
        status === "invalid"
          ? reasonCodes
              .map((r) => `${r.field ?? "-"}:${r.code}`)
              .slice(0, 8)
              .join(",")
          : null,
    });
  }

  // batch insert
  const chunk = 200;
  for (let i = 0; i < rowInserts.length; i += chunk) {
    const slice = rowInserts.slice(i, i + chunk);
    const { error: insErr } = await admin.from("import_rows").insert(slice as never);
    if (insErr) throw new Error(insErr.message);
  }

  const nextStatus = counters.error === counters.total ? "failed" : "ready";
  await admin
    .from("import_jobs")
    .update({
      status: nextStatus,
      row_count: counters.total,
      detected_encoding: usedEnc,
      preview_summary: counters,
      summary: counters,
    })
    .eq("id", input.importJobId);

  await admin.from("audit_logs").insert({
    actor_id: input.actorId,
    actor_name: input.actorName,
    action: "import.validated",
    entity_type: "import_job",
    notion_page_id: null,
    changed_fields: {
      import_job_id: input.importJobId,
      entity_type: entity,
      counters,
    },
    operation_source: "csv_import",
    request_id: uuidV5(`import:validated:${input.importJobId}`),
  } as never);

  return { ok: nextStatus === "ready", summary: counters };
}
