import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmailOrNull } from "@/lib/normalize/email";
import { normalizePhone } from "@/lib/normalize/phone";
import type { CustomerCandidate } from "@/lib/inquiries/types";

function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name
    .replace(/株式会社|有限会社|合同会社|\(株\)|（株）/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return s.length >= 2 ? s : null;
}

function emailDomain(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const d = email.split("@")[1]?.toLowerCase();
  if (!d) return null;
  if (["gmail.com", "yahoo.co.jp", "outlook.com", "hotmail.com"].includes(d)) {
    return null;
  }
  return d;
}

/**
 * 既存顧客候補。自動 link しない。表示名のみでは strong にしない。
 */
export async function findCustomerCandidates(input: {
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
}): Promise<CustomerCandidate[]> {
  const admin = createAdminClient();
  const email = normalizeEmailOrNull(input.email ?? null);
  const phone = normalizePhone(input.phone ?? null);
  const company = normalizeCompany(input.companyName);
  const domain = emailDomain(email);

  const out: CustomerCandidate[] = [];
  const seen = new Set<string>();

  const push = (c: CustomerCandidate) => {
    const key = `${c.kind}:${c.contactPageId ?? c.customerPageId}:${c.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  if (email) {
    const { data: contacts } = await admin
      .from("contact_index")
      .select("notion_page_id,customer_page_id,name,email")
      .eq("email", email)
      .eq("is_active", true)
      .limit(5);
    for (const c of contacts ?? []) {
      if (!c.customer_page_id) continue;
      push({
        kind: "contact",
        customerPageId: c.customer_page_id,
        contactPageId: c.notion_page_id,
        displayName: c.name || "(無題)",
        reason: "メール完全一致（担当者）",
        strength: "strong",
      });
    }
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id,display_name,email")
      .eq("email", email)
      .eq("is_archived", false)
      .limit(5);
    for (const c of customers ?? []) {
      push({
        kind: "customer",
        customerPageId: c.notion_page_id,
        contactPageId: null,
        displayName: c.display_name || "(無題)",
        reason: "メール完全一致（顧客）",
        strength: "strong",
      });
    }
  }

  if (phone) {
    const { data: contacts } = await admin
      .from("contact_index")
      .select("notion_page_id,customer_page_id,name")
      .eq("phone_normalized", phone)
      .eq("is_active", true)
      .limit(5);
    for (const c of contacts ?? []) {
      if (!c.customer_page_id) continue;
      push({
        kind: "contact",
        customerPageId: c.customer_page_id,
        contactPageId: c.notion_page_id,
        displayName: c.name || "(無題)",
        reason: "電話完全一致（担当者）",
        strength: "strong",
      });
    }
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id,display_name")
      .eq("phone_normalized", phone)
      .eq("is_archived", false)
      .limit(5);
    for (const c of customers ?? []) {
      push({
        kind: "customer",
        customerPageId: c.notion_page_id,
        contactPageId: null,
        displayName: c.display_name || "(無題)",
        reason: "電話完全一致（顧客）",
        strength: "strong",
      });
    }
  }

  if (company) {
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id,display_name,legal_name")
      .eq("is_archived", false)
      .or(
        `display_name.ilike.%${company}%,legal_name.ilike.%${company}%`,
      )
      .limit(5);
    for (const c of customers ?? []) {
      push({
        kind: "customer",
        customerPageId: c.notion_page_id,
        contactPageId: null,
        displayName: c.display_name || c.legal_name || "(無題)",
        reason: "会社名の類似",
        strength: "weak",
      });
    }
  }

  if (domain) {
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id,display_name,email")
      .eq("is_archived", false)
      .ilike("email", `%@${domain}`)
      .limit(5);
    for (const c of customers ?? []) {
      push({
        kind: "customer",
        customerPageId: c.notion_page_id,
        contactPageId: null,
        displayName: c.display_name || "(無題)",
        reason: "メールドメイン一致",
        strength: "weak",
      });
    }
  }

  out.sort((a, b) => {
    if (a.strength !== b.strength) {
      return a.strength === "strong" ? -1 : 1;
    }
    return a.displayName.localeCompare(b.displayName, "ja");
  });
  return out.slice(0, 12);
}
