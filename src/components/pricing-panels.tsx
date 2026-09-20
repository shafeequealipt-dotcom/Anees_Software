"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePriceListAction, setItemPricesAction, setPartyRatesAction } from "@/app/actions/admin";
import { formatMoney, toBasisPoints, toPaise } from "@/lib/money";
import { region } from "@/lib/region";
import { Alert, Badge, Button, Checkbox, Field, Input, Panel, Select, Table, td, th } from "./ui";

// ─── Settings: the price lists themselves ────────────────────────────────────

export function PriceListManager({ lists }: { lists: { id: number; name: string; active: boolean }[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ id?: number; name: string; active: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const res = await savePriceListAction(edit);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEdit(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Price lists"
        padded={false}
        actions={
          <Button size="sm" variant="primary" onClick={() => (setError(null), setEdit({ name: "", active: true }))}>
            + Add price list
          </Button>
        }
      >
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          Use price lists when different customers get different selling prices, e.g. Retail and Wholesale. Set an item&apos;s price for each list on the item&apos;s page, then choose a list on the customer. New bills pick the price up automatically. You can still
          change it on the bill.
        </p>
        {lists.length === 0 ? (
          <p className="p-4 text-sm text-muted">No price lists yet.</p>
        ) : (
          <Table>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className={l.active ? "" : "opacity-60"}>
                  <td className={td}>
                    {l.name} {!l.active && <Badge>hidden</Badge>}
                  </td>
                  <td className={td + " text-right"}>
                    <Button size="sm" variant="ghost" onClick={() => (setError(null), setEdit(l))}>
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
        <Panel title={edit.id ? "Edit price list" : "Add price list"}>
          <div className="grid max-w-md gap-4">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Wholesale" autoFocus />
            </Field>
            <Checkbox label="Show in dropdowns" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
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

// ─── Item page: this item's price on each list ───────────────────────────────

export function ItemPricesPanel({ itemId, normalPricePaise, rows }: { itemId: number; normalPricePaise: number; rows: { priceListId: number; name: string; salePricePaise: number | null; includesTax: boolean }[] }) {
  const router = useRouter();
  const [v, setV] = useState(() => rows.map((r) => ({ ...r, price: r.salePricePaise === null ? "" : String(r.salePricePaise / 100) })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return null;

  async function save() {
    setBusy(true);
    setMsg(null);
    const bad = v.find((r) => r.price !== "" && Number.isNaN(toPaise(r.price)));
    if (bad) {
      setBusy(false);
      return setMsg({ ok: false, text: `Check the price for ${bad.name}.` });
    }
    const res = await setItemPricesAction(
      itemId,
      v.map((r) => ({ priceListId: r.priceListId, salePricePaise: r.price === "" ? null : toPaise(r.price), includesTax: r.includesTax })),
    );
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <Panel title="Prices on price lists">
      <p className="mb-2 text-xs text-muted">Normal price: {formatMoney(normalPricePaise)}. Leave a list empty to use the normal price.</p>
      {msg && <div className="mb-2"><Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert></div>}
      <div className="flex flex-col gap-2">
        {v.map((r, i) => (
          <div key={r.priceListId} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate">{r.name}</span>
            <Input value={r.price} onChange={(e) => setV((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))} inputMode="decimal" className="num" placeholder={String(normalPricePaise / 100)} />
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <input type="checkbox" className="accent-brand-600" checked={r.includesTax} onChange={(e) => setV((x) => x.map((y, j) => (j === i ? { ...y, includesTax: e.target.checked } : y)))} /> incl. tax
            </label>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save prices"}
        </Button>
      </div>
    </Panel>
  );
}

// ─── Party page: special rates for this customer ─────────────────────────────

interface Rate {
  itemId: number;
  itemName: string;
  rate: string;
  disc: string;
  normalPaise: number;
}

export function PartyRatesPanel({ partyId, items, initial }: { partyId: number; items: { id: number; name: string; salePricePaise: number }[]; initial: { itemId: number; itemName: string; ratePaise: number | null; discountBp: number | null; salePricePaise: number }[] }) {
  const router = useRouter();
  const [rates, setRates] = useState<Rate[]>(() => initial.map((r) => ({ itemId: r.itemId, itemName: r.itemName, rate: r.ratePaise === null ? "" : String(r.ratePaise / 100), disc: r.discountBp === null ? "" : String(r.discountBp / 100), normalPaise: r.salePricePaise })));
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = region().currencyCode;
  const available = items.filter((i) => !rates.some((r) => r.itemId === i.id));

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload = rates.map((r) => ({ itemId: r.itemId, ratePaise: r.rate === "" ? null : toPaise(r.rate), discountBp: r.disc === "" ? null : toBasisPoints(r.disc) }));
    if (payload.some((p) => Number.isNaN(p.ratePaise) || Number.isNaN(p.discountBp))) {
      setBusy(false);
      return setMsg({ ok: false, text: "Check the numbers." });
    }
    const res = await setPartyRatesAction(partyId, payload);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <Panel title="Special rates for this customer" padded={false}>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">A special rate replaces the price on new bills for this customer. Or give a percentage off instead.</p>
      {msg && <div className="p-3"><Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert></div>}
      {rates.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={th + " text-right"}>Special rate ({cur})</th>
              <th className={th + " text-right"}>or % off</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={r.itemId}>
                <td className={td}>
                  {r.itemName}
                  <div className="text-xs text-faint">Normal {formatMoney(r.normalPaise)}</div>
                </td>
                <td className={td}>
                  <Input value={r.rate} onChange={(e) => setRates((x) => x.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} inputMode="decimal" className="num text-right" />
                </td>
                <td className={td}>
                  <Input value={r.disc} onChange={(e) => setRates((x) => x.map((y, j) => (j === i ? { ...y, disc: e.target.value } : y)))} inputMode="decimal" className="num text-right" />
                </td>
                <td className={td + " text-right"}>
                  <Button size="sm" variant="ghost" onClick={() => setRates((x) => x.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} className="max-w-xs">
          <option value="">Add an item…</option>
          {available.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          disabled={!pick}
          onClick={() => {
            const it = items.find((i) => i.id === Number(pick));
            if (it) setRates((x) => [...x, { itemId: it.id, itemName: it.name, rate: "", disc: "", normalPaise: it.salePricePaise }]);
            setPick("");
          }}
        >
          Add
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save rates"}
        </Button>
      </div>
    </Panel>
  );
}
