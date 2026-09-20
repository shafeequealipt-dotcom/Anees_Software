"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteJournalAction, disposeAssetAction, postJournalAction, rebuildBooksAction, runDepreciationAction, saveAssetAction, saveGlAccountAction } from "@/app/actions/accounting";
import { todayIST } from "@/lib/dates";
import { formatMoney, toBasisPoints, toPaise } from "@/lib/money";
import { Alert, Badge, Button, Checkbox, Field, Input, Panel, Select, Table, td, th } from "./ui";

// ─── Chart of accounts: add or change your own accounts ──────────────────────

interface Acc {
  id?: number;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  grp: string;
  active: boolean;
}

export function AccountManager({ accounts }: { accounts: (Acc & { id: number })[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Acc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const res = await saveGlAccountAction(edit);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEdit(null);
    router.refresh();
  }

  async function rebuild() {
    if (!confirm("Rebuild the books from all your bills? Manual journal entries and fixed assets are kept. This can take a moment.")) return;
    setBusy(true);
    const res = await rebuildBooksAction();
    setBusy(false);
    setNote(res.ok ? "Books rebuilt." : res.error);
    router.refresh();
  }

  return (
    <Panel
      title="Your own accounts"
      padded={false}
      actions={
        <div className="flex gap-2">
          <Button size="sm" onClick={rebuild} disabled={busy}>
            Rebuild books
          </Button>
          <Button size="sm" variant="primary" onClick={() => (setError(null), setEdit({ name: "", type: "liability", grp: "", active: true }))}>
            + Add account
          </Button>
        </div>
      }
    >
      {note && <div className="p-3"><Alert tone="brand">{note}</Alert></div>}
      {accounts.length > 0 && (
        <Table>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={a.active ? "" : "opacity-60"}>
                <td className={td}>
                  {a.name} <span className="text-xs capitalize text-muted">({a.type})</span> {!a.active && <Badge>hidden</Badge>}
                </td>
                <td className={td + " text-right"}>
                  <Button size="sm" variant="ghost" onClick={() => (setError(null), setEdit(a))}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {edit && (
        <div className="grid max-w-xl gap-4 border-t border-line p-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Name">
            <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Bank loan" autoFocus />
          </Field>
          <Field label="Type">
            <Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as Acc["type"] })}>
              <option value="asset">Asset (something you own or are owed)</option>
              <option value="liability">Liability (something you owe)</option>
              <option value="equity">Equity (owner's money in the business)</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </Select>
          </Field>
          <Field label="Section (optional)" hint="How it is grouped on reports, e.g. Long-term liabilities.">
            <Input value={edit.grp} onChange={(e) => setEdit({ ...edit, grp: e.target.value })} />
          </Field>
          <Checkbox label="In use" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="self-end pb-2" />
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="primary" onClick={save} disabled={busy || !edit.name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ─── Manual journal entry ────────────────────────────────────────────────────

export function JournalForm({ accounts }: { accounts: { id: number; code: string; name: string }[] }) {
  const router = useRouter();
  const blank = () => ({ accountId: "", debit: "", credit: "", memo: "" });
  const [date, setDate] = useState(todayIST());
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState([blank(), blank()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dr = lines.reduce((s, l) => s + (toPaise(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (toPaise(l.credit) || 0), 0);
  const set = (i: number, patch: Partial<ReturnType<typeof blank>>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function post() {
    setBusy(true);
    setError(null);
    const used = lines.filter((l) => l.accountId || l.debit || l.credit);
    const res = await postJournalAction({
      date,
      narration,
      lines: used.map((l) => ({ accountId: Number(l.accountId), debitPaise: toPaise(l.debit) || 0, creditPaise: toPaise(l.credit) || 0, memo: l.memo })),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push("/accounting/journal");
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="What is this for?" className="sm:col-span-2">
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Loan received from HDFC" />
        </Field>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <Table>
          <thead>
            <tr>
              <th className={th}>Account</th>
              <th className={th + " w-36 text-right"}>Debit</th>
              <th className={th + " w-36 text-right"}>Credit</th>
              <th className={th}>Note</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className={td}>
                  <Select value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                    <option value="">Choose…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className={td}>
                  <Input value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} inputMode="decimal" className="num text-right" />
                </td>
                <td className={td}>
                  <Input value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} inputMode="decimal" className="num text-right" />
                </td>
                <td className={td}>
                  <Input value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} />
                </td>
                <td className={td}>
                  {lines.length > 2 && (
                    <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>
                <Button size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
                  + Add line
                </Button>
              </td>
              <td className={td + " num text-right"}>{formatMoney(dr, { symbol: false })}</td>
              <td className={td + " num text-right"}>{formatMoney(cr, { symbol: false })}</td>
              <td className={td} colSpan={2}>
                {dr === cr && dr > 0 ? <span className="text-good">Balanced</span> : <span className="text-warn">Out by {formatMoney(Math.abs(dr - cr), { symbol: false })}</span>}
              </td>
            </tr>
          </tbody>
        </Table>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.push("/accounting/journal")}>Cancel</Button>
        <Button variant="primary" onClick={post} disabled={busy || dr !== cr || dr === 0}>
          {busy ? "Posting…" : "Post entry"}
        </Button>
      </div>
    </div>
  );
}

export function DeleteJournalButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        if (!confirm("Delete this journal entry?")) return;
        await deleteJournalAction(id);
        router.refresh();
      }}
    >
      Delete
    </Button>
  );
}

// ─── Fixed assets ────────────────────────────────────────────────────────────

interface Asset {
  id: number;
  name: string;
  category: string;
  purchaseDate: string;
  costPaise: number;
  method: string;
  rateBp: number;
  accumulatedPaise: number;
  bookValuePaise: number;
  disposedOn: string | null;
}

export function AssetsManager({ assets, pending, cashAccounts, editable }: { assets: Asset[]; pending: { label: string; from: string; assets: number }[]; cashAccounts: { id: number; name: string }[]; editable: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ name: "", category: "Equipment", purchaseDate: todayIST(), cost: "", salvage: "", method: "straight_line", rate: "10", paidFrom: "" });
  const [sell, setSell] = useState<{ id: number; date: string; proceeds: string; accountId: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));

  async function add() {
    setBusy(true);
    setMsg(null);
    const res = await saveAssetAction({
      name: v.name,
      category: v.category,
      purchaseDate: v.purchaseDate,
      costPaise: toPaise(v.cost) || 0,
      salvagePaise: toPaise(v.salvage) || 0,
      method: v.method as "straight_line",
      rateBp: toBasisPoints(v.rate) || 0,
      paidFromAccountId: v.paidFrom ? Number(v.paidFrom) : null,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setAdding(false);
    setV({ ...v, name: "", cost: "", salvage: "" });
    router.refresh();
  }

  async function depreciate(from: string) {
    setBusy(true);
    setMsg(null);
    const res = await runDepreciationAction(from);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: `Depreciation posted on ${res.posted} asset${res.posted === 1 ? "" : "s"}.` } : { ok: false, text: res.error });
    router.refresh();
  }

  async function dispose() {
    if (!sell) return;
    setBusy(true);
    setMsg(null);
    const res = await disposeAssetAction(sell.id, { date: sell.date, proceedsPaise: toPaise(sell.proceeds) || 0, accountId: sell.accountId ? Number(sell.accountId) : null });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setSell(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {msg && <Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert>}
      {pending.length > 0 && (
        <Panel title="Depreciation waiting to be posted">
          <p className="mb-2 text-sm text-muted">Post each year once it has ended (or now, for the current year). Each button charges that year&apos;s depreciation to every asset that has not had it yet.</p>
          <div className="flex flex-wrap gap-2">
            {pending.map((y) => (
              <Button key={y.from} onClick={() => depreciate(y.from)} disabled={busy}>
                Post {y.label} ({y.assets} asset{y.assets === 1 ? "" : "s"})
              </Button>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Fixed assets" padded={false} actions={editable ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>+ Add asset</Button> : undefined}>
        {assets.length === 0 ? (
          <p className="p-4 text-sm text-muted">No fixed assets yet. Add vehicles, machinery, furniture, computers and so on to have them depreciated in your books.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Asset</th>
                <th className={th}>Bought</th>
                <th className={th + " text-right"}>Cost</th>
                <th className={th}>Depreciation</th>
                <th className={th + " text-right"}>Written off</th>
                <th className={th + " text-right"}>Book value</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className={a.disposedOn ? "opacity-60" : ""}>
                  <td className={td}>
                    {a.name}
                    <div className="text-xs text-faint">{a.category}</div>
                  </td>
                  <td className={td}>{a.purchaseDate}</td>
                  <td className={td + " num text-right"}>{formatMoney(a.costPaise, { symbol: false })}</td>
                  <td className={td + " text-xs"}>
                    {a.rateBp / 100}% {a.method === "reducing" ? "reducing balance" : "straight line"}
                  </td>
                  <td className={td + " num text-right"}>{formatMoney(a.accumulatedPaise, { symbol: false })}</td>
                  <td className={td + " num text-right font-medium"}>{a.disposedOn ? <Badge>sold {a.disposedOn}</Badge> : formatMoney(a.bookValuePaise, { symbol: false })}</td>
                  <td className={td + " text-right"}>
                    {editable && !a.disposedOn && (
                      <Button size="sm" variant="ghost" onClick={() => setSell({ id: a.id, date: todayIST(), proceeds: "", accountId: cashAccounts[0] ? String(cashAccounts[0].id) : "" })}>
                        Sold / scrapped
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {sell && (
        <Panel title="Sold or scrapped">
          <div className="grid max-w-xl gap-4 sm:grid-cols-3">
            <Field label="Date">
              <Input type="date" value={sell.date} onChange={(e) => setSell({ ...sell, date: e.target.value })} />
            </Field>
            <Field label="Sale amount" hint="0 if scrapped">
              <Input value={sell.proceeds} onChange={(e) => setSell({ ...sell, proceeds: e.target.value })} inputMode="decimal" className="num" />
            </Field>
            <Field label="Money came into">
              <Select value={sell.accountId} onChange={(e) => setSell({ ...sell, accountId: e.target.value })}>
                <option value="">—</option>
                {cashAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2 sm:col-span-3">
              <Button variant="primary" onClick={dispose} disabled={busy}>
                Record
              </Button>
              <Button onClick={() => setSell(null)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}

      {adding && (
        <Panel title="Add a fixed asset">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Delivery van" autoFocus />
            </Field>
            <Field label="Kind" hint="Assets of one kind are added together on the balance sheet.">
              <Input value={v.category} onChange={(e) => set("category", e.target.value)} placeholder="Vehicles, Furniture, Computers…" />
            </Field>
            <Field label="Bought on">
              <Input type="date" value={v.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
            </Field>
            <Field label="Cost">
              <Input value={v.cost} onChange={(e) => set("cost", e.target.value)} inputMode="decimal" className="num" />
            </Field>
            <Field label="Paid from" hint="Leave as 'Already owned' for something you had before using this app.">
              <Select value={v.paidFrom} onChange={(e) => set("paidFrom", e.target.value)}>
                <option value="">Already owned</option>
                {cashAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Scrap value at the end (optional)">
              <Input value={v.salvage} onChange={(e) => set("salvage", e.target.value)} inputMode="decimal" className="num" />
            </Field>
            <Field label="Depreciation method">
              <Select value={v.method} onChange={(e) => set("method", e.target.value)}>
                <option value="straight_line">Straight line (same amount each year)</option>
                <option value="reducing">Reducing balance (percentage of what is left)</option>
              </Select>
            </Field>
            <Field label="Yearly rate (%)">
              <Input value={v.rate} onChange={(e) => set("rate", e.target.value)} inputMode="decimal" className="num" />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={add} disabled={busy || !v.name.trim() || !v.cost}>
                {busy ? "Saving…" : "Add asset"}
              </Button>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
