"use client";

import { useState } from "react";

import { PromoteDialog } from "@/features/prospects/promote-dialog";

export function ProspectPromoteButton(props: {
  prospectId: string;
  membershipId: string | null;
  companyName: string;
  formalMatchPageId: string | null;
  formalMatchConfidence: string | null;
  contacts: Array<{
    id: string;
    name: string;
    department: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
  }>;
  nextContactAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded border border-emerald-600 px-2 py-1 text-emerald-800 hover:bg-emerald-50"
        onClick={() => setOpen(true)}
      >
        正式な組織に昇格
      </button>
      {open ? (
        <PromoteDialog
          {...props}
          contacts={props.contacts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
