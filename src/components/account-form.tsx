"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveAccountAction } from "@/app/actions/masters";
import { toPaise } from "@/lib/money";
import { Alert, Button, Checkbox, Field, Input } from "./ui";

export interface AccountFormValue {
  id?: number;
  kind: "cash" | "bank";
  name: string;
  bankName: string | null;
  accountNo: string | null;
  ifsc: string | null;
  upiId: string | null;
  openingBalancePaise: number;
  openingDate: string | null;
  isDefault: boolean;
  active: boolean;
}

const r = (p: number | null | undefined) => (p ? String(Math.abs(p) / 100) : "");

export function AccountForm({ initial }: { initial?: AccountFormValue }) {
  const router = useRouter();
  const [v, setV] = useState({
    kind: initial?.kind ?? "bank",
    name: initial?.name ?? "",
    bankName: initial?.bankName ?? "",
    accountNo: initial?.accountNo ?? "",
    ifsc: initial?.ifsc ?? "",
    upiId: initial?.upiId ?? "",
    opening: r(initial?.openingBalancePaise),
    openingSide: (initial?.openingBalancePaise ?? 0) < 0 ? "negative" : "positive",
    openingDate: initial?.openingDate ?? "",
    isDefault: initial?.isDefault ?? false,
    active: initial?.active ?? true,
  });
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.msg : null);
  const isBank = v.kind === "bank";

  async function save() {
    setSaving(true);
    setError(null);
    const opening = toPaise(v.opening) || 0;
    const res = await saveAccountAction({
      id: initial?.id,
      kind: v.kind as "cash" | "bank",
      name: v.name,
      bankName: isBank ? v.bankName || null : null,
      accountNo: isBank ? v.accountNo || null : null,
      ifsc: isBank ? v.ifsc || null : null,
      upiId: v.upiId || null,
      openingBalancePaise: v.openingSide === "negative" ? -opening : opening,
      openingDate: v.openingDate || null,
      isDefault: v.isDefault,
      active: v.active,
    });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    router.push(`/cash-bank/${res.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        {!initial && (
          <Field label="Type" className="sm:col-span-2">
            <div className="flex gap-2">
              <Button variant={v.kind === "bank" ? "primary" : "secondary"} onClick={() => set("kind", "bank")}>
                Bank account
              </Button>
              <Button variant={v.kind === "cash" ? "primary" : "secondary"} onClick={() => set("kind", "cash")}>
                Cash
              </Button>
            </div>
          </Field>
        )}
        <Field label="Display name" error={err("name")} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder={isBank ? "e.g. HDFC Current A/c" : "e.g. Cash in hand"} autoFocus />
        </Field>
        {isBank && (
          <>
            <Field label="Bank name">
              <Input value={v.bankName} onChange={(e) => set("bankName", e.target.value)} />
            </Field>
            <Field label="Account number">
              <Input value={v.accountNo} onChange={(e) => set("accountNo", e.target.value)} />
            </Field>
            <Field label="IFSC" error={err("ifsc")} hint="e.g. SBIN0001234">
              <Input value={v.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase())} className="font-mono uppercase" />
            </Field>
            <Field label="UPI ID">
              <Input value={v.upiId} onChange={(e) => set("upiId", e.target.value)} placeholder="business@bank" />
            </Field>
          </>
        )}
        <Field label="Opening balance (₹)">
          <div className="flex gap-2">
            <Input value={v.opening} onChange={(e) => set("opening", e.target.value)} inputMode="decimal" className="num" placeholder="0" />
            <select className="h-9 rounded-md border border-line bg-panel px-2 text-sm" value={v.openingSide} onChange={(e) => set("openingSide", e.target.value)}>
              <option value="positive">Balance</option>
              <option value="negative">Overdrawn</option>
            </select>
          </div>
        </Field>
        <Field label="As of date" hint="Leave empty for 1 April of this financial year.">
          <Input type="date" value={v.openingDate} onChange={(e) => set("openingDate", e.target.value)} />
        </Field>
        <Checkbox label={`Use as the default ${v.kind} account on new bills`} checked={v.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="sm:col-span-2" />
        {initial && <Checkbox label="Active" checked={v.active} onChange={(e) => set("active", e.target.checked)} />}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || !v.name.trim()}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add account"}
        </Button>
      </div>
    </div>
  );
}
