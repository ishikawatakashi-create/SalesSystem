import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmailOrNull, normalizePhone } from "@/lib/normalize";
import { writeProspectAudit } from "@/lib/prospects/audit";
import { normalizePersonNameForCompare } from "@/lib/prospects/normalize";

export async function createProspectContactInline(input: {
  prospectId: string;
  name: string;
  department?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  actorId: string;
  actorName: string;
}): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("name_required");
  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select("id")
    .eq("id", input.prospectId)
    .is("archived_at", null)
    .maybeSingle();
  if (!prospect) throw new Error("prospect_not_found");

  const { data, error } = await admin
    .from("prospect_contacts")
    .insert({
      prospect_id: input.prospectId,
      name,
      normalized_name: normalizePersonNameForCompare(name) || name.toLowerCase(),
      department: input.department?.trim() || null,
      title: input.title?.trim() || null,
      email: input.email?.trim() || null,
      normalized_email: normalizeEmailOrNull(input.email),
      phone: input.phone?.trim() || null,
      normalized_phone: normalizePhone(input.phone),
      is_primary: false,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "contact_create_failed");

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: "prospect_contact.created_inline",
    entityType: "prospect_contact",
    entityId: String(data.id),
    changedFields: {
      prospect_id: input.prospectId,
      name,
    },
  });
  return { id: String(data.id) };
}
