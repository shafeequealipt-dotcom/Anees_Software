"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePreferencesAction } from "@/app/actions/admin";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import type { VoucherType } from "@/db/schema";
import { Alert, Button, Checkbox, Field, Input, Panel, Select, Textarea } from "./ui";

interface Values {
  creditLimitMode: "off" | "warn" | "block";
  allowNegativeStock: boolean;
  roundOff: boolean;
  lineDiscount: boolean;
  billDiscount: boolean;
  defaultPriceIncludesTax: boolean;
  showMrp: boolean;
  printPaperSize: "A4" | "A5" | "thermal";
  thermalWidthMm: 58 | 80;
  invoiceLayout: "classic" | "modern";
  invoiceAccentColor: string;
  showBankDetailsOnInvoice: boolean;
  showUpiQrOnInvoice: boolean;
  tdsTcsEnabled: boolean;
  quotationTerms: string;
  prefixes: Record<VoucherType, string>;
}

const NUMBERED: VoucherType[] = ["sale_invoice", "credit_note", "quotation", "sales_order", "delivery_challan", "purchase_bill", "debit_note", "purchase_order", "payment_in", "payment_out", "expense", "other_income"];

export function PreferencesForm({ initial, india }: { initial: Values; india: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: val }));
  };

  async function save() {
    setBusy(true);
    setError(null);
    const res = await savePreferencesAction(v);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="bad">{error}</Alert>}
      {saved && <Alert tone="good">Saved.</Alert>}
      <Panel title="On bills">
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Checkbox label="Round off the bill total" checked={v.roundOff} onChange={(e) => set("roundOff", e.target.checked)} />
          <Checkbox label="Allow a discount on each line" checked={v.lineDiscount} onChange={(e) => set("lineDiscount", e.target.checked)} />
          <Checkbox label="Allow a discount on the whole bill" checked={v.billDiscount} onChange={(e) => set("billDiscount", e.target.checked)} />
          <Checkbox label="Prices include tax by default" checked={v.defaultPriceIncludesTax} onChange={(e) => set("defaultPriceIncludesTax", e.target.checked)} />
          <Checkbox label="Show MRP on bills" checked={v.showMrp} onChange={(e) => set("showMrp", e.target.checked)} />
          <Checkbox label="Allow selling more than is in stock" checked={v.allowNegativeStock} onChange={(e) => set("allowNegativeStock", e.target.checked)} />
          {india && <Checkbox label="Use TCS and TDS on bills (tax collected / deducted at source)" checked={v.tdsTcsEnabled} onChange={(e) => set("tdsTcsEnabled", e.target.checked)} className="sm:col-span-2" />}
          <Field label="When a customer goes over their credit limit" className="sm:col-span-2" hint="Set each customer's limit on their party page.">
            <Select value={v.creditLimitMode} onChange={(e) => set("creditLimitMode", e.target.value as Values["creditLimitMode"])}>
              <option value="off">Do nothing</option>
              <option value="warn">Warn me, but save the bill</option>
              <option value="block">Don&apos;t let the bill be saved</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel title="On printed invoices">
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Field label="Paper" hint="Receipts suit a shop counter printer.">
            <Select
              value={v.printPaperSize === "thermal" ? `t${v.thermalWidthMm}` : v.printPaperSize}
              onChange={(e) => {
                const x = e.target.value;
                setSaved(false);
                if (x === "t80" || x === "t58") setV((p) => ({ ...p, printPaperSize: "thermal", thermalWidthMm: x === "t80" ? 80 : 58 }));
                else setV((p) => ({ ...p, printPaperSize: x as "A4" | "A5" }));
              }}
            >
              <option value="A4">A4 page</option>
              <option value="A5">A5 (half page)</option>
              <option value="t80">Thermal receipt, 80 mm</option>
              <option value="t58">Thermal receipt, 58 mm</option>
            </Select>
          </Field>
          <Field label="Invoice style" hint="Applies to A4 and A5 pages.">
            <Select value={v.invoiceLayout} onChange={(e) => set("invoiceLayout", e.target.value as "classic" | "modern")}>
              <option value="classic">Classic (plain, black and white friendly)</option>
              <option value="modern">Modern (coloured header and table)</option>
            </Select>
          </Field>
          <Field label="Accent colour">
            <input type="color" value={v.invoiceAccentColor} onChange={(e) => set("invoiceAccentColor", e.target.value)} className="h-9 w-20 cursor-pointer rounded-md border border-line bg-panel p-1" />
          </Field>
          <Checkbox label="Show bank details" checked={v.showBankDetailsOnInvoice} onChange={(e) => set("showBankDetailsOnInvoice", e.target.checked)} />
          {india && <Checkbox label="Show a UPI payment QR code on unpaid invoices" checked={v.showUpiQrOnInvoice} onChange={(e) => set("showUpiQrOnInvoice", e.target.checked)} />}
          <Field label="Default terms on quotations" className="sm:col-span-2">
            <Textarea rows={2} value={v.quotationTerms} onChange={(e) => set("quotationTerms", e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Bill number prefixes">
        <p className="mb-3 text-sm text-muted">The letters printed before the number, e.g. INV- gives INV-1, INV-2. Changing a prefix starts a new series from 1. Bills already made keep theirs.</p>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
          {NUMBERED.map((t) => (
            <Field key={t} label={VOUCHER_INFO[t].label}>
              <Input value={v.prefixes[t] ?? ""} onChange={(e) => set("prefixes", { ...v.prefixes, [t]: e.target.value })} maxLength={12} className="font-mono" />
            </Field>
          ))}
        </div>
      </Panel>

      <div>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
