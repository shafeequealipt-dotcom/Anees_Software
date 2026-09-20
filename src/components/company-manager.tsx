"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCompanyAction, setCompanyActiveAction } from "@/app/actions/admin";
import { GST_STATES } from "@/lib/gst/states";
import { REGIONS, type Country } from "@/lib/region";
import { Alert, Badge, Button, Field, Input, Panel, Select, Table, Textarea, td, th } from "./ui";

interface Company {
  id: number;
  name: string;
  country: string;
  taxId: string | null;
  active: boolean;
}

export function CompanyManager({ companies, currentId }: { companies: Company[]; currentId: number }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ name: "", country: "IN" as Country, taxId: "", stateCode: "", address: "", phone: "" });
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const r = REGIONS[v.country];
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.msg : null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createCompanyAction({ name: v.name, country: v.country, taxId: v.taxId, gstScheme: v.taxId ? "regular" : "unregistered", stateCode: r.usesStates ? v.stateCode : "", address: v.address, phone: v.phone });
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field === "gstin" ? "taxId" : res.field });
    setAdding(false);
    setV({ name: "", country: "IN", taxId: "", stateCode: "", address: "", phone: "" });
    router.refresh();
  }

  async function toggle(c: Company) {
    setBusy(true);
    const res = await setCompanyActiveAction(c.id, !c.active);
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error });
    setError(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      <Panel
        title={`Companies (${companies.length})`}
        padded={false}
        actions={
          <Button size="sm" variant="primary" onClick={() => (setAdding(true), setError(null))}>
            + Add company
          </Button>
        }
      >
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          Each company keeps its own parties, items, bills, cash &amp; bank, tax rates, bill numbers and reports. The country decides the currency and tax (GST or VAT). Switch between companies from the name at the top of the page. Give staff access on the Users tab.
        </p>
        <Table>
          <thead>
            <tr>
              <th className={th}>Company</th>
              <th className={th}>Country</th>
              <th className={th}>Tax number</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                <td className={td}>
                  <span className="font-medium">{c.name}</span> {c.id === currentId && <Badge tone="brand">open now</Badge>} {!c.active && <Badge tone="neutral">hidden</Badge>}
                </td>
                <td className={td}>{c.country === "SA" ? "Saudi Arabia (SAR, VAT)" : "India (INR, GST)"}</td>
                <td className={td + " font-mono text-xs"}>{c.taxId}</td>
                <td className={td + " text-right"}>
                  {c.id !== currentId && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(c)}>
                      {c.active ? "Hide" : "Show again"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      {adding && (
        <Panel title="Add a company">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Company name" error={err("name")}>
              <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
            </Field>
            <Field label="Country" hint="Can't be changed later.">
              <Select value={v.country} onChange={(e) => set("country", e.target.value as Country)}>
                <option value="IN">India (₹, GST)</option>
                <option value="SA">Saudi Arabia (SAR, VAT)</option>
              </Select>
            </Field>
            <Field label={`${r.taxIdLabel} (optional)`} error={err("taxId")} hint={r.taxIdHint}>
              <Input value={v.taxId} onChange={(e) => set("taxId", e.target.value.toUpperCase())} maxLength={15} className="font-mono uppercase" />
            </Field>
            {r.usesStates && (
              <Field label="State (optional)" error={err("stateCode")}>
                <Select value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
                  <option value="">Not set</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Phone">
              <Input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea rows={2} value={v.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={create} disabled={busy || !v.name.trim()}>
                {busy ? "Adding…" : "Add company"}
              </Button>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
