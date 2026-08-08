import { createHash } from "node:crypto";

import { normalizeCompanyNameForSearch } from "@/lib/normalize/company";
import { normalizeDomain } from "@/lib/normalize/domain";
import { normalizeEmailOrNull } from "@/lib/normalize/email";
import { normalizePhone } from "@/lib/normalize/phone";
import { normalizePostalCode } from "@/lib/normalize/postal";
import { collapseWhitespace, toHalfWidthAscii, toSearchLower } from "@/lib/normalize/text";
import { normalizeUrl, sanitizeUrlForStorage } from "@/lib/normalize/url";
import type { ProspectStagedRow } from "@/lib/prospects/types";

export function normalizePersonNameForCompare(
  value: string | null | undefined,
): string {
  if (!value) return "";
  return collapseWhitespace(toSearchLower(value));
}

export function buildProspectSearchText(input: {
  companyName: string;
  prefecture?: string | null;
  city?: string | null;
  address?: string | null;
  industry?: string | null;
  websiteUrl?: string | null;
  mainPhone?: string | null;
}): string {
  return [
    input.companyName,
    input.prefecture,
    input.city,
    input.address,
    input.industry,
    input.websiteUrl,
    input.mainPhone,
  ]
    .filter(Boolean)
    .join(" ");
}

export type NormalizedProspectFields = {
  companyName: string;
  normalizedCompanyName: string;
  websiteUrl: string | null;
  normalizedDomain: string | null;
  mainPhone: string | null;
  normalizedPhone: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  industry: string | null;
  employeeRange: string | null;
  searchText: string;
};

export function normalizeProspectCore(input: {
  companyName: string;
  websiteUrl?: string | null;
  domain?: string | null;
  mainPhone?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  address?: string | null;
  industry?: string | null;
  employeeRange?: string | null;
}): NormalizedProspectFields {
  const companyName = collapseWhitespace(toHalfWidthAscii(input.companyName.trim()));
  const websiteUrl =
    sanitizeUrlForStorage(input.websiteUrl) ??
    (normalizeUrl(input.websiteUrl) ? sanitizeUrlForStorage(input.websiteUrl) : null);
  const normalizedDomain =
    normalizeDomain(input.domain) ??
    normalizeDomain(input.websiteUrl) ??
    null;
  const mainPhone = input.mainPhone?.trim() || null;
  const normalizedPhone = normalizePhone(mainPhone);
  const postalCode =
    normalizePostalCode(input.postalCode) ??
    (input.postalCode?.trim() || null);
  const prefecture = input.prefecture?.trim() || null;
  const city = input.city?.trim() || null;
  const address = input.address?.trim() || null;
  const industry = input.industry?.trim() || null;
  const employeeRange = input.employeeRange?.trim() || null;

  return {
    companyName,
    normalizedCompanyName: normalizeCompanyNameForSearch(companyName),
    websiteUrl,
    normalizedDomain,
    mainPhone,
    normalizedPhone,
    postalCode,
    prefecture,
    city,
    address,
    industry,
    employeeRange,
    searchText: buildProspectSearchText({
      companyName,
      prefecture,
      city,
      address,
      industry,
      websiteUrl,
      mainPhone,
    }),
  };
}

/** Sensitive keys never stored in source_attributes */
const BLOCKED_ATTR_KEYS =
  /pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential/i;

export function filterSourceAttributes(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (BLOCKED_ATTR_KEYS.test(k)) continue;
    if (v == null) continue;
    if (typeof v === "string" && v.length > 2000) {
      out[k] = `${v.slice(0, 2000)}…`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function computeSourceRowHash(input: {
  companyName: string;
  normalizedDomain: string | null;
  normalizedPhone: string | null;
  contactEmail: string | null;
  externalRecordId: string | null;
  websiteUrl: string | null;
  address: string | null;
}): string {
  if (input.externalRecordId?.trim()) {
    return createHash("sha256")
      .update(`ext:${input.externalRecordId.trim()}`)
      .digest("hex");
  }
  const payload = [
    normalizeCompanyNameForSearch(input.companyName),
    input.normalizedDomain ?? "",
    input.normalizedPhone ?? "",
    normalizeEmailOrNull(input.contactEmail) ?? "",
    (input.websiteUrl ?? "").toLowerCase().trim(),
    (input.address ?? "").toLowerCase().trim(),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function stagedToNormalized(staged: ProspectStagedRow): {
  core: NormalizedProspectFields;
  contact: {
    name: string | null;
    department: string | null;
    title: string | null;
    email: string | null;
    normalizedEmail: string | null;
    phone: string | null;
    normalizedPhone: string | null;
  };
  sourceRowHash: string;
  sourceAttributes: Record<string, unknown>;
} {
  const core = normalizeProspectCore({
    companyName: staged.companyName,
    websiteUrl: staged.websiteUrl,
    domain: staged.domain,
    mainPhone: staged.mainPhone,
    postalCode: staged.postalCode,
    prefecture: staged.prefecture,
    city: staged.city,
    address: staged.address,
    industry: staged.industry,
    employeeRange: staged.employeeRange,
  });
  const email = staged.contactEmail?.trim() || null;
  const phone = staged.contactPhone?.trim() || null;
  return {
    core,
    contact: {
      name: staged.contactName?.trim() || null,
      department: staged.contactDepartment?.trim() || null,
      title: staged.contactTitle?.trim() || null,
      email,
      normalizedEmail: normalizeEmailOrNull(email),
      phone,
      normalizedPhone: normalizePhone(phone),
    },
    sourceRowHash: computeSourceRowHash({
      companyName: core.companyName,
      normalizedDomain: core.normalizedDomain,
      normalizedPhone: core.normalizedPhone,
      contactEmail: email,
      externalRecordId: staged.externalRecordId,
      websiteUrl: core.websiteUrl,
      address: core.address,
    }),
    sourceAttributes: filterSourceAttributes(staged.sourceAttributes),
  };
}
