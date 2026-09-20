"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCustomFieldAction } from "@/app/actions/admin";
import { Alert, Badge, Button, Checkbox, Field, Input, Panel, Select, Table, td, th } from "./ui";

interface F {
  id?: number;
  name: string;
  kind: "text" | "number" | "date" | "yesno";
  showOnInvoice: boolean;
  active: boolean;
}

const KIND = { text: "Text", number: "Number", date: "Date", yesno: "Yes / No" };

export function CustomFieldManager({ fields }: { fields: (F & { id: number })[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<F | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const res = await saveCustomFieldAction(edit);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEdit(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Extra fields on items" padded={false} actions={<Button size="sm" variant="primary" onClick={() => (setError(null), setEdit({ name: "", kind: "text", showOnInvoice: false, active: true }))}>+ Add field</Button>}>
        <p className="border-b border-line px-4 py-3 text-sm text-muted">Add your own details to items, such as Brand, Warranty or Shelf life. They appear on the item form and item page, in the Excel import/export, and (if you choose) on printed invoices under the item name.</p>
        {fields.length === 0 ? (
          <p className="p-4 text-sm text-muted">No extra fields yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Field</th>
                <th className={th}>Type</th>
                <th className={th}>On invoices</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className={f.active ? "" : "opacity-60"}>
                  <td className={td}>
                    {f.name} {!f.active && <Badge>hidden</Badge>}
                  </td>
                  <td className={td}>{KIND[f.kind]}</td>
                  <td className={td}>{f.showOnInvoice ? "Yes" : "No"}</td>
                  <td className={td + " text-right"}>
                    <Button size="sm" variant="ghost" onClick={() => (setError(null), setEdit(f))}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {edit && (
        <Panel title={edit.id ? "Edit field" : "Add field"}>
          <div className="grid max-w-md gap-4">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Brand" autoFocus />
            </Field>
            <Field label="Type" hint={edit.id ? "The type can't be changed once created." : undefined}>
              <Select value={edit.kind} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, kind: e.target.value as F["kind"] })}>
                {Object.entries(KIND).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox label="Print on invoices under the item name" checked={edit.showOnInvoice} onChange={(e) => setEdit({ ...edit, showOnInvoice: e.target.checked })} />
            <Checkbox label="In use" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
            <div className="flex gap-2">
              <Button variant="primary" onClick={save} disabled={busy || !edit.name.trim()}>
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
