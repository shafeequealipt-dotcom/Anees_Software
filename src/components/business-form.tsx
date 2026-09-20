"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveFirmAction } from "@/app/actions/admin";
import { GST_STATES } from "@/lib/gst/states";
import { region } from "@/lib/region";
import { Alert, Button, Field, Input, Select, Textarea } from "./ui";

export interface FirmValue {
  name: string;
  legalName: string | null;
  gstin: string | null;
  gstScheme: "regular" | "composition" | "unregistered";
  stateCode: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  upiId: string | null;
  invoiceTerms: string | null;
}

export function BusinessForm({ initial }: { initial: FirmValue }) {
  const router = useRouter();
  const r = region();
  const [v, setV] = useState(() => Object.fromEntries(Object.entries(initial).map(([k, x]) => [k, x ?? ""])) as Record<keyof FirmValue, string>);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FirmValue, val: string) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: val }));
  };
  const err = (f: string) => (error?.field === f ? error.msg : null);
  const sa = r.country === "SA";

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveFirmAction({
      name: v.name,
      legalName: v.legalName,
      taxId: v.gstin,
      gstScheme: v.gstScheme as FirmValue["gstScheme"],
      stateCode: v.stateCode,
      address: v.address,
      city: v.city,
      pincode: v.pincode,
      phone: v.phone,
      email: v.email,
      website: v.website,
      bankName: v.bankName,
      bankAccountNo: v.bankAccountNo,
      bankIfsc: v.bankIfsc,
      bankBranch: v.bankBranch,
      upiId: v.upiId,
      invoiceTerms: v.invoiceTerms,
    });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    setSaved(true);
    router.refresh();
  }

  const box = "grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      {saved && <Alert tone="good">Saved.</Alert>}
      <div className={box}>
        <h2 className="text-sm font-semibold sm:col-span-2">Business</h2>
        <Field label="Business name" error={err("name")}>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Legal name" hint="If different. Printed on invoices.">
          <Input value={v.legalName} onChange={(e) => set("legalName", e.target.value)} />
        </Field>
        <Field label={`${r.taxIdLabel} (optional)`} error={err("taxId")} hint={r.taxIdHint}>
          <Input value={v.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={15} />
        </Field>
        {r.usesStates ? (
          <Field label="State" error={err("stateCode")} hint="Decides CGST + SGST or IGST on bills.">
            <Select value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
              <option value="">Not set</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div />
        )}
        {r.country === "IN" && v.gstin && (
          <Field label="GST scheme">
            <Select value={v.gstScheme} onChange={(e) => set("gstScheme", e.target.value)}>
              <option value="regular">Regular</option>
              <option value="composition">Composition</option>
              <option value="unregistered">Not registered</option>
            </Select>
          </Field>
        )}
        <Field label="Country" hint="Chosen at setup and can't be changed, because amounts and taxes are stored for that country.">
          <Input value={r.countryName} disabled />
        </Field>
      </div>
      <div className={box}>
        <h2 className="text-sm font-semibold sm:col-span-2">Address and contact</h2>
        <Field label="Address" className="sm:col-span-2">
          <Textarea value={v.address} onChange={(e) => set("address", e.target.value)} rows={2} />
        </Field>
        <Field label="City">
          <Input value={v.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={sa ? "Postal code" : "PIN code"}>
          <Input value={v.pincode} onChange={(e) => set("pincode", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email" error={err("email")}>
          <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Website" className="sm:col-span-2">
          <Input value={v.website} onChange={(e) => set("website", e.target.value)} />
        </Field>
      </div>
      <div className={box}>
        <h2 className="text-sm font-semibold sm:col-span-2">Bank details for invoices</h2>
        <Field label="Bank name">
          <Input value={v.bankName} onChange={(e) => set("bankName", e.target.value)} />
        </Field>
        <Field label={sa ? "IBAN / account number" : "Account number"}>
          <Input value={v.bankAccountNo} onChange={(e) => set("bankAccountNo", e.target.value)} />
        </Field>
        <Field label={sa ? "SWIFT / branch code" : "IFSC"}>
          <Input value={v.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} className="font-mono uppercase" />
        </Field>
        <Field label="Branch">
          <Input value={v.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} />
        </Field>
        {!sa && (
          <Field label="UPI ID" className="sm:col-span-2">
            <Input value={v.upiId} onChange={(e) => set("upiId", e.target.value)} placeholder="business@bank" />
          </Field>
        )}
      </div>
      <div className={box}>
        <h2 className="text-sm font-semibold sm:col-span-2">Invoice</h2>
        <Field label="Terms and conditions" hint="Printed at the bottom of invoices." className="sm:col-span-2">
          <Textarea value={v.invoiceTerms} onChange={(e) => set("invoiceTerms", e.target.value)} rows={3} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={saving || !v.name.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
