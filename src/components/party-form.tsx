"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePartyAction, savePartyGroupAction } from "@/app/actions/masters";
import { GST_STATES } from "@/lib/gst/states";
import { toPaise } from "@/lib/money";
import { region } from "@/lib/region";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "./ui";

export interface PartyFormValue {
  id?: number;
  kind: "customer" | "supplier" | "both";
  name: string;
  nameAr?: string | null;
  addressAr?: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateCode: string | null;
  groupId: number | null;
  priceListId?: number | null;
  openingBalancePaise: number;
  openingDate: string | null;
  creditDays: number | null;
  creditLimitPaise: number | null;
  notes: string | null;
  active: boolean;
}

const r = (p: number | null | undefined) => (p ? String(Math.abs(p) / 100) : "");

export function PartyForm({
  initial,
  groups: initialGroups,
  priceLists = [],
  hideContact,
  hideBalance,
}: {
  initial?: PartyFormValue;
  groups: { id: number; name: string }[];
  priceLists?: { id: number; name: string }[];
  hideContact?: boolean;
  hideBalance?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    kind: initial?.kind ?? "customer",
    name: initial?.name ?? "",
    nameAr: initial?.nameAr ?? "",
    addressAr: initial?.addressAr ?? "",
    gstin: initial?.gstin ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    billingAddress: initial?.billingAddress ?? "",
    shippingAddress: initial?.shippingAddress ?? "",
    sameShipping: !initial?.shippingAddress,
    stateCode: initial?.stateCode ?? "",
    groupId: initial?.groupId ? String(initial.groupId) : "",
    priceListId: initial?.priceListId ? String(initial.priceListId) : "",
    opening: r(initial?.openingBalancePaise),
    openingSide: (initial?.openingBalancePaise ?? 0) < 0 ? "pay" : "receive",
    openingDate: initial?.openingDate ?? "",
    creditDays: initial?.creditDays != null ? String(initial.creditDays) : "",
    creditLimit: r(initial?.creditLimitPaise),
    notes: initial?.notes ?? "",
    active: initial?.active ?? true,
  });
  const [groups, setGroups] = useState(initialGroups);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.msg : null);

  async function save() {
    setSaving(true);
    setError(null);
    const opening = toPaise(v.opening) || 0;
    const res = await savePartyAction({
      id: initial?.id,
      kind: v.kind as PartyFormValue["kind"],
      name: v.name,
      nameAr: v.nameAr || null,
      addressAr: v.addressAr || null,
      gstin: v.gstin || null,
      phone: v.phone || null,
      email: v.email || null,
      billingAddress: v.billingAddress || null,
      shippingAddress: v.sameShipping ? null : v.shippingAddress || null,
      stateCode: v.stateCode || null,
      groupId: v.groupId ? Number(v.groupId) : null,
      priceListId: v.priceListId ? Number(v.priceListId) : null,
      openingBalancePaise: v.openingSide === "pay" ? -opening : opening,
      openingDate: v.openingDate || null,
      creditDays: v.creditDays ? Number(v.creditDays) : null,
      creditLimitPaise: v.creditLimit ? toPaise(v.creditLimit) : null,
      notes: v.notes || null,
      active: v.active,
    });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    router.push(`/parties/${res.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus={!initial} />
        </Field>
        <Field label="Type">
          <Select value={v.kind} onChange={(e) => set("kind", e.target.value as typeof v.kind)}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
            <option value="both">Both customer and supplier</option>
          </Select>
        </Field>
        {region().country === "SA" && (
          <>
            <Field label="Arabic name (الاسم)" hint="Printed on bilingual invoices.">
              <Input value={v.nameAr} onChange={(e) => set("nameAr", e.target.value)} dir="rtl" />
            </Field>
            <Field label="Arabic address (العنوان)">
              <Input value={v.addressAr} onChange={(e) => set("addressAr", e.target.value)} dir="rtl" />
            </Field>
          </>
        )}
        <Field label="Group">
          <div className="flex gap-2">
            <Select value={v.groupId} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button
              size="md"
              onClick={async () => {
                const name = prompt("New group name (e.g. Retailers, Wholesale, Mumbai)");
                if (!name) return;
                const res = await savePartyGroupAction(name);
                if (res.ok) {
                  setGroups((g) => [...g.filter((x) => x.id !== res.id), { id: res.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
                  set("groupId", String(res.id));
                }
              }}
            >
              New
            </Button>
          </div>
        </Field>
        {!hideContact && (
          <>
        {priceLists.length > 0 && (
          <Field label="Price list" hint="Which selling prices this customer gets on new bills.">
            <Select value={v.priceListId} onChange={(e) => set("priceListId", e.target.value)}>
              <option value="">Normal prices</option>
              {priceLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Phone" error={err("phone")}>
          <Input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email" error={err("email")}>
          <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={`${region().taxIdLabel} (optional)`} error={err("gstin")} hint={region().usesStates ? "State fills in from the GSTIN." : "15 digits, starts and ends with 3."}>
          <Input
            value={v.gstin}
            maxLength={15}
            className="font-mono uppercase"
            onChange={(e) => {
              const g = region().usesStates ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, "");
              set("gstin", g);
              if (region().usesStates && /^\d{2}/.test(g) && GST_STATES.some((s) => s.code === g.slice(0, 2))) set("stateCode", g.slice(0, 2));
            }}
          />
        </Field>
        {region().usesStates && (
        <Field label="State (optional)" error={err("stateCode")}>
          <Select value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
            <option value="">Not set</option>
            {GST_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} – {s.name}
              </option>
            ))}
          </Select>
        </Field>
        )}
        <Field label="Billing address" className="sm:col-span-2">
          <Textarea rows={2} value={v.billingAddress} onChange={(e) => set("billingAddress", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label="Shipping address is the same" checked={v.sameShipping} onChange={(e) => set("sameShipping", e.target.checked)} />
          {!v.sameShipping && <Textarea className="mt-2" rows={2} value={v.shippingAddress} onChange={(e) => set("shippingAddress", e.target.value)} placeholder="Shipping address" />}
        </div>
          </>
        )}
      </div>

      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">Balance & credit</h2>
        {!hideBalance && (
          <>
        <Field label={`Opening balance (${region().currencyCode})`} hint="What was pending before you started using this app.">
          <div className="flex gap-2">
            <Input value={v.opening} onChange={(e) => set("opening", e.target.value)} inputMode="decimal" className="num" placeholder="0" />
            <Select value={v.openingSide} onChange={(e) => set("openingSide", e.target.value)} className="w-40">
              <option value="receive">To receive</option>
              <option value="pay">To pay</option>
            </Select>
          </div>
        </Field>
        <Field label="As of date" hint="Leave empty for 1 April of this financial year.">
          <Input type="date" value={v.openingDate} onChange={(e) => set("openingDate", e.target.value)} />
        </Field>
        <Field label="Credit period (days)" hint="Sets the due date on new bills.">
          <Input value={v.creditDays} onChange={(e) => set("creditDays", e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
        </Field>
        <Field label={`Credit limit (${region().currencyCode})`}>
          <Input value={v.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} inputMode="decimal" className="num" />
        </Field>
          </>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {initial && <Checkbox label="Active (show in party lists)" checked={v.active} onChange={(e) => set("active", e.target.checked)} />}
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || !v.name.trim()}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add party"}
        </Button>
      </div>
    </div>
  );
}
