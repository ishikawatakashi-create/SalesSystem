import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeProspectAudit } from "@/lib/prospects/audit";

export async function setProspectDoNotContact(input: {
  prospectId: string;
  doNotContact: boolean;
  reason?: string | null;
  actorId: string;
  actorName: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("prospects")
    .update({
      do_not_contact: input.doNotContact,
      do_not_contact_reason: input.doNotContact
        ? input.reason?.trim() || null
        : null,
      do_not_contact_at: input.doNotContact
        ? new Date().toISOString()
        : null,
    })
    .eq("id", input.prospectId);
  if (error) throw new Error(error.message);

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: input.doNotContact ? "prospect.dnc_set" : "prospect.dnc_cleared",
    entityType: "prospect",
    entityId: input.prospectId,
    changedFields: {
      do_not_contact: input.doNotContact,
      reason: input.reason?.trim() || null,
    },
  });
}
