"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveTaxRateAction, saveUnitAction } from "@/app/actions/masters";
import { region } from "@/lib/region";
import { Alert, Badge, Button, Checkbox, Field, Input, Panel, Select, Table, td, th } from "./ui";

interface Rate {
  id: number;
  name: string;
  gstBp: number;
  nature: "taxable" | "exempt" | "nil" | "non_gst";
  active: boolean;
}

const NATURE: Record<Rate["nature"], string> = { taxable: "Taxable", exempt: "Exempt", nil: "Zero-rated / nil", non_gst: "Out of scope" };
const pct = (bp: number) => `${(bp / 100).toString()}%`;

export function TaxRateManager({ rates }: { rates: Rate[] }) {
  const router = useRouter();
  const taxName = region().taxName;
  const [edit, setEdit] = useState<Partial<Rate> | null>(null);
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(r: Partial<Rate>) {
    setEdit(r);
    setRate(r.gstBp !== undefined ? String(r.gstBp / 100) : "");
    setError(null);
  }

  async function save() {
    if (!edit) return;
    const n = Number(rate || 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) return setError("Enter a rate between 0 and 100.");
    setBusy(true);
    const res = await saveTaxRateAction({
      id: edit.id,
      name: edit.name ?? "",
      gstBp: Math.round(n * 100),
      nature: edit.nature ?? "taxable",
      active: edit.active ?? true,
      sort: edit.id ? undefined : rates.length + 1,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEdit(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={`${taxName} rates`}
        padded={false}
        actions={
          <Button size="sm" variant="primary" onClick={() => open({ nature: "taxable", active: true })}>
            + Add rate
          </Button>
        }
      >
        <Table>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th + " text-right"}>Rate</th>
              <th className={th}>Type</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                <td className={td}>{r.name}</td>
                <td className={td + " num text-right"}>{pct(r.gstBp)}</td>
                <td className={td}>
                  {NATURE[r.nature]} {!r.active && <Badge tone="neutral">hidden</Badge>}
                </td>
                <td className={td + " text-right"}>
                  <Button size="sm" variant="ghost" onClick={() => open(r)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {edit && (
        <Panel title={edit.id ? "Edit rate" : "Add rate"}>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            {error && (
              <div className="sm:col-span-2">
                <Alert tone="bad">{error}</Alert>
              </div>
            )}
            <Field label="Name">
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={`e.g. ${taxName} 15%`} autoFocus />
            </Field>
            <Field label="Rate (%)">
              <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="num" />
            </Field>
            <Field label="Type">
              <Select value={edit.nature ?? "taxable"} onChange={(e) => setEdit({ ...edit, nature: e.target.value as Rate["nature"] })}>
                {Object.entries(NATURE).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox label="Show in item and bill dropdowns" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="self-end pb-2" />
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={save} disabled={busy || !edit.name?.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
      <p className="text-xs text-muted">Changing a rate here doesn't change bills already made. It applies to items and bills you create or edit after this.</p>
    </div>
  );
}

interface Unit {
  id: number;
  name: string;
  code: string;
  active: boolean;
}

export function UnitManager({ units }: { units: Unit[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Partial<Unit> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const res = await saveUnitAction({ id: edit.id, name: edit.name ?? "", code: edit.code ?? "", active: edit.active ?? true });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEdit(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Units of measure"
        padded={false}
        actions={
          <Button size="sm" variant="primary" onClick={() => (setError(null), setEdit({ active: true }))}>
            + Add unit
          </Button>
        }
      >
        <Table>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Short code</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                <td className={td}>
                  {u.name} {!u.active && <Badge tone="neutral">hidden</Badge>}
                </td>
                <td className={td + " font-mono"}>{u.code}</td>
                <td className={td + " text-right"}>
                  <Button size="sm" variant="ghost" onClick={() => (setError(null), setEdit(u))}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {edit && (
        <Panel title={edit.id ? "Edit unit" : "Add unit"}>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            {error && (
              <div className="sm:col-span-2">
                <Alert tone="bad">{error}</Alert>
              </div>
            )}
            <Field label="Name">
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Dozen" autoFocus />
            </Field>
            <Field label="Short code">
              <Input value={edit.code ?? ""} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={10} className="font-mono uppercase" placeholder="DOZ" />
            </Field>
            <Checkbox label="Show in item dropdowns" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="sm:col-span-2" />
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={save} disabled={busy || !edit.name?.trim() || !edit.code?.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
