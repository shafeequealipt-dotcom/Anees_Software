"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { receiveTransferAction } from "@/app/actions/vouchers";
import { formatQty, milliToQty, toMilli } from "@/lib/money";
import { gridKeyDown } from "@/lib/grid-keys";
import { ProductName } from "./product-name";
import { Alert, Button, Panel, Table, Textarea, td, th } from "./ui";

type Line = { id: number; itemCode: string | null; description: string; qtyMilli: number; unitCode: string | null };

export function ReceiveTransferForm({ voucherId, lines }: { voucherId: number; lines: Line[] }) {
  const router = useRouter();
  const [received, setReceived] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, milliToQty(l.qtyMilli).toString()])));
  const [damaged, setDamaged] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, "0"])));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const payload = lines.map((l) => ({ lineId: l.id, receivedQtyMilli: toMilli(received[l.id]), damagedQtyMilli: toMilli(damaged[l.id]) }));
    for (const p of payload) {
      if (Number.isNaN(p.receivedQtyMilli) || Number.isNaN(p.damagedQtyMilli)) return setError("Enter valid quantities.");
    }
    if (!confirm("Confirm what actually arrived? This can't be undone (you can still cancel the whole transfer afterwards).")) return;
    setBusy(true);
    const res = await receiveTransferAction(voucherId, payload, notes.trim() || null);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <Panel title="Confirm receipt">
      <div onKeyDown={(e) => gridKeyDown(e)}>
      <Table>
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={th + " text-right"}>Sent</th>
            <th className={th + " text-right"}>Received</th>
            <th className={th + " text-right"}>Damaged</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} data-row={l.id}>
              <td className={td}><ProductName code={l.itemCode} name={l.description} /></td>
              <td className={td + " num text-right text-muted"}>
                {formatQty(l.qtyMilli)} {l.unitCode}
              </td>
              <td className={td + " text-right"}>
                <input
                  data-cell="received"
                  className="num w-24 rounded-md border border-line bg-panel px-2 py-1 text-right text-sm"
                  value={received[l.id]}
                  onChange={(e) => setReceived((r) => ({ ...r, [l.id]: e.target.value }))}
                  inputMode="decimal"
                />
              </td>
              <td className={td + " text-right"}>
                <input
                  data-cell="damaged"
                  className="num w-24 rounded-md border border-line bg-panel px-2 py-1 text-right text-sm"
                  value={damaged[l.id]}
                  onChange={(e) => setDamaged((d) => ({ ...d, [l.id]: e.target.value }))}
                  inputMode="decimal"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      </div>
      <div className="p-4">
        <label className="mb-1 block text-xs font-medium uppercase text-muted">Notes (e.g. reason for any shortage)</label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        <p className="mt-2 text-xs text-muted">Anything not marked received or damaged is treated as lost in transit and removed from stock.</p>
        {error && (
          <div className="mt-2">
            <Alert tone="bad">{error}</Alert>
          </div>
        )}
        <div className="mt-3">
          <Button onClick={submit} disabled={busy}>
            {busy ? "Confirming…" : "Confirm receipt"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
