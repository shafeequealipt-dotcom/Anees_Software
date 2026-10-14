"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePartnerAction } from "@/app/actions/partners";
import { deleteEmployeeAction } from "@/app/actions/staff";
import { Alert, Button } from "./ui";

const KINDS = {
  employee: { noun: "employee", action: deleteEmployeeAction, list: "/staff/all", kept: "They have salary payments on record, so they were made inactive instead of deleted. Their past payments stay in your books." },
  partner: { noun: "partner", action: deletePartnerAction, list: "/partners/all", kept: "They have payments or invoices on record, so they were made inactive instead of deleted. Those stay in your books." },
} as const;

/** Delete an employee or a partner (owners only; the page shows it only to them). */
export function DeletePersonButton({ kind, id, name }: { kind: keyof typeof KINDS; id: number; name: string }) {
  const k = KINDS[kind];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="text-bad"
        disabled={busy}
        onClick={async () => {
          if (!confirm(`Delete the ${k.noun} “${name}”? This can't be undone. If they have payments on record they'll be made inactive instead, so past entries stay correct.`)) return;
          setBusy(true);
          const res = await k.action(id);
          setBusy(false);
          if (!res.ok) return setMsg({ ok: false, text: res.error });
          if (res.outcome === "deactivated") {
            setMsg({ ok: true, text: k.kept });
            router.refresh();
          } else {
            router.push(k.list);
            router.refresh();
          }
        }}
      >
        {busy ? "Deleting…" : "Delete"}
      </Button>
      {msg && (
        <div className="max-w-sm">
          <Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert>
        </div>
      )}
    </div>
  );
}
