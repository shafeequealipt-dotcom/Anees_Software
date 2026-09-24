"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveLocationAction, setLocationActiveAction } from "@/app/actions/locations";
import { Alert, Badge, Button, Field, Input, Panel, Select, Table, Textarea, td, th } from "./ui";

interface Location {
  id: number;
  name: string;
  kind: "warehouse" | "shop";
  code: string | null;
  address: string | null;
  phone: string | null;
  active: boolean;
}

const blank = { id: undefined as number | undefined, name: "", kind: "shop" as "warehouse" | "shop", code: "", address: "", phone: "" };

export function LocationManager({ locations }: { locations: Location[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<typeof blank | null>(null);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof blank>(k: K, val: (typeof blank)[K]) => setEditing((x) => (x ? { ...x, [k]: val } : x));
  const err = (f: string) => (error?.field === f ? error.msg : null);

  function startAdd() {
    setEditing(blank);
    setError(null);
  }
  function startEdit(l: Location) {
    setEditing({ id: l.id, name: l.name, kind: l.kind, code: l.code ?? "", address: l.address ?? "", phone: l.phone ?? "" });
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const res = await saveLocationAction(editing);
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    setEditing(null);
    router.refresh();
  }

  async function toggle(l: Location) {
    setBusy(true);
    const res = await setLocationActiveAction(l.id, !l.active);
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error });
    setError(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      <Panel
        title={`Shops & warehouse (${locations.length})`}
        padded={false}
        actions={
          <Button size="sm" variant="primary" onClick={startAdd}>
            + Add shop or warehouse
          </Button>
        }
      >
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          Stock and out-of-stock are tracked separately for each shop and the warehouse. Assign staff to specific shops from Settings › Users.
        </p>
        <Table>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Kind</th>
              <th className={th}>Code</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className={l.active ? "" : "opacity-60"}>
                <td className={td}>
                  <button className="font-medium text-brand-600 hover:underline" onClick={() => startEdit(l)}>
                    {l.name}
                  </button>{" "}
                  {!l.active && <Badge tone="neutral">hidden</Badge>}
                </td>
                <td className={td}>{l.kind === "warehouse" ? "Warehouse" : "Shop"}</td>
                <td className={td + " font-mono text-xs"}>{l.code}</td>
                <td className={td + " text-right"}>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(l)}>
                    {l.active ? "Hide" : "Show again"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      {editing && (
        <Panel title={editing.id ? "Edit shop or warehouse" : "Add a shop or warehouse"}>
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Name" error={err("name")}>
              <Input value={editing.name} onChange={(e) => set("name", e.target.value)} autoFocus />
            </Field>
            <Field label="Kind">
              <Select value={editing.kind} onChange={(e) => set("kind", e.target.value as "warehouse" | "shop")}>
                <option value="shop">Shop</option>
                <option value="warehouse">Warehouse</option>
              </Select>
            </Field>
            <Field label="Code (optional)" hint="A short code printed on bills from here." error={err("code")}>
              <Input value={editing.code} onChange={(e) => set("code", e.target.value)} maxLength={20} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={editing.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea rows={2} value={editing.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={save} disabled={busy || !editing.name.trim()}>
                {busy ? "Saving…" : editing.id ? "Save changes" : "Add"}
              </Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
