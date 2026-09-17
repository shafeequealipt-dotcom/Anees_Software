"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteItemAction, deletePartyAction } from "@/app/actions/masters";
import { Alert, Button } from "./ui";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button size="sm" onClick={() => window.print()} className="no-print">
      {label}
    </Button>
  );
}

export function WhatsAppButton({ phone, text, label = "WhatsApp reminder" }: { phone: string | null; text: string; label?: string }) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return (
    <a
      className="no-print inline-flex h-8 items-center rounded-md border border-line bg-panel px-2.5 text-sm font-medium hover:bg-ground"
      href={`https://wa.me/${intl}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener"
    >
      {label}
    </a>
  );
}

export function DeleteMasterButton({ kind, id, name }: { kind: "party" | "item"; id: number; name: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="no-print flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="text-bad"
        onClick={async () => {
          if (!confirm(`Delete “${name}”? If it's already used on bills it will be made inactive instead, so old bills stay correct.`)) return;
          const res = kind === "party" ? await deletePartyAction(id) : await deleteItemAction(id);
          if (!res.ok) return setMsg(res.error);
          if (res.outcome === "deactivated") {
            setMsg("It's used on bills, so it was made inactive instead of deleted.");
            router.refresh();
          } else {
            router.push(kind === "party" ? "/parties" : "/items");
            router.refresh();
          }
        }}
      >
        Delete
      </Button>
      {msg && <Alert>{msg}</Alert>}
    </div>
  );
}
