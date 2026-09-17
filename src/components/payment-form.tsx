"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { openBillsAction, saveVoucherAction } from "@/app/actions/vouchers";
import { formatDate } from "@/lib/dates";
import { formatINR, toPaise } from "@/lib/money";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import type { VoucherFormData } from "@/server/form-data";
import { Combobox } from "./combobox";
import { Alert, Button, Field, Input, Money, PartyBalance, Select, Textarea } from "./ui";

const MODES = ["Cash", "UPI", "Bank transfer", "Card", "Cheque"];
const rupees = (p: number) => (p / 100).toFixed(2).replace(/\.00$/, "");

type Bill = Awaited<ReturnType<typeof openBillsAction>>["bills"][number];

export function PaymentForm({ data }: { data: VoucherFormData }) {
  const router = useRouter();
  const info = VOUCHER_INFO[data.type];
  const ex = data.existing?.voucher;
  const incoming = data.type === "payment_in";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const [partyId, setPartyId] = useState<number | null>(ex?.partyId ?? data.presetPartyId ?? null);
  const [date, setDate] = useState(ex?.date ?? today);
  const [number, setNumber] = useState(ex ? String(ex.number) : "");
  const [amount, setAmount] = useState(ex ? rupees(ex.totalPaise) : "");
  const defaultAccount = data.accounts.find((a) => a.isDefault) ?? data.accounts[0];
  const [accountId, setAccountId] = useState<number | null>(ex?.accountId ?? defaultAccount?.id ?? null);
  const [mode, setMode] = useState(ex?.paymentMode ?? "Cash");
  const [ref, setRef] = useState(ex?.paymentRef ?? "");
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const [bills, setBills] = useState<Bill[]>([]);
  const [balance, setBalance] = useState(0);
  const [alloc, setAlloc] = useState<Record<number, string>>(() =>
    Object.fromEntries((data.existing?.settles ?? []).map((s) => [s.id, rupees(s.amountPaise)])),
  );
  const [manual, setManual] = useState(!!data.existing?.settles.length);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const party = data.parties.find((p) => p.id === partyId) ?? null;

  useEffect(() => {
    if (!partyId) {
      setBills([]);
      setBalance(0);
      return;
    }
    let live = true;
    openBillsAction(partyId, data.type, ex?.id).then((r) => {
      if (!live) return;
      setBills(r.bills);
      setBalance(r.balancePaise);
    });
    return () => {
      live = false;
    };
  }, [partyId, data.type, ex?.id]);

  const amountPaise = Number.isNaN(toPaise(amount)) ? 0 : toPaise(amount);

  // Oldest bills first, unless the user edits the split
  const autoAlloc = useMemo(() => {
    let left = amountPaise;
    const out: Record<number, number> = {};
    for (const b of bills) {
      const take = Math.min(left, b.balancePaise);
      if (take > 0) out[b.id] = take;
      left -= take;
    }
    return out;
  }, [bills, amountPaise]);

  const allocation = manual
    ? Object.fromEntries(Object.entries(alloc).map(([k, v]) => [Number(k), Math.max(0, toPaise(v) || 0)]))
    : autoAlloc;
  const allocated = Object.values(allocation).reduce((s, v) => s + v, 0);
  const advance = amountPaise - allocated;

  async function save() {
    setError(null);
    if (!partyId) return setError("Choose the party.");
    if (amountPaise <= 0) return setError("Enter the amount.");
    if (manual && allocated > amountPaise) return setError("You've settled more against bills than the payment amount.");
    setSaving(true);
    const res = await saveVoucherAction({
      id: ex?.id,
      type: data.type,
      number: number ? Number(number) : undefined,
      date,
      partyId,
      amountPaise,
      accountId,
      paymentMode: mode,
      paymentRef: ref || null,
      notes: notes || null,
      allocations: manual ? Object.entries(allocation).filter(([, v]) => v > 0).map(([k, v]) => ({ toVoucherId: Number(k), amountPaise: v })) : undefined,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    router.push(`${info.path}/${res.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{ex ? `Edit ${info.label.toLowerCase()} ${ex.prefix}${ex.number}` : incoming ? "Receive payment" : "Make payment"}</h1>
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label={incoming ? "Received from" : "Paid to"} className="sm:col-span-2">
          <Combobox
            options={data.parties.map((p) => ({
              value: p.id,
              label: p.name,
              keywords: p.phone ?? "",
              render: (
                <div className="flex justify-between gap-3">
                  <span>{p.name}</span>
                  <PartyBalance paise={p.balancePaise} className="text-xs" />
                </div>
              ),
            }))}
            value={partyId}
            onChange={(v) => {
              setPartyId(v);
              setAlloc({});
              setManual(false);
            }}
            placeholder="Search party…"
            autoFocus={!ex}
          />
          {party && (
            <p className="mt-1 text-xs text-muted">
              Current balance: <PartyBalance paise={balance} />
            </p>
          )}
        </Field>
        <Field label="Amount (₹)">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="num text-lg font-semibold" placeholder="0" />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={incoming ? "Received into" : "Paid from"}>
          <Select value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        {mode !== "Cash" && (
          <Field label="Reference / UTR / cheque no.">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
        )}
        <Field label="Receipt number" hint={ex ? undefined : `Leave empty for ${data.settings.prefix}${data.nextNumber}`}>
          <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} placeholder={String(data.nextNumber)} inputMode="numeric" />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {partyId && (
        <div className="rounded-lg border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">Settle against bills</h2>
            {bills.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!manual) setAlloc(Object.fromEntries(Object.entries(autoAlloc).map(([k, v]) => [k, rupees(v)])));
                  setManual(!manual);
                }}
              >
                {manual ? "Settle oldest first automatically" : "Choose bills myself"}
              </Button>
            )}
          </div>
          {bills.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">No unpaid bills for this party. The amount will be kept as an advance.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2">Bill</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">Unpaid</th>
                  <th className="w-36 px-4 py-2 text-right">Settle now</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      {VOUCHER_INFO[b.type].label} {b.number}
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {formatDate(b.date)}
                      {b.dueDate && b.dueDate < today && <span className="ml-1 text-xs text-bad">overdue</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money paise={b.balancePaise} />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {manual ? (
                        <Input value={alloc[b.id] ?? ""} onChange={(e) => setAlloc((a) => ({ ...a, [b.id]: e.target.value }))} className="num h-8 text-right" inputMode="decimal" placeholder="0" />
                      ) : (
                        <Money paise={autoAlloc[b.id] ?? 0} blankZero />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex justify-end gap-6 border-t border-line px-4 py-2.5 text-sm">
            <span className="text-muted">
              Settled: <Money paise={allocated} className="text-ink" />
            </span>
            {advance !== 0 && (
              <span className={advance < 0 ? "text-bad" : "text-muted"}>
                {advance > 0 ? "Advance" : "Over-settled"}: <Money paise={Math.abs(advance)} />
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : `Save ${formatINR(amountPaise)}`}
        </Button>
      </div>
    </div>
  );
}

export function MoneyForm({ data }: { data: VoucherFormData }) {
  const router = useRouter();
  const ex = data.existing?.voucher;
  const transfer = data.type === "money_transfer";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [date, setDate] = useState(ex?.date ?? today);
  const [amount, setAmount] = useState(ex ? rupees(ex.totalPaise) : "");
  const [accountId, setAccountId] = useState<number | null>(ex?.accountId ?? data.accounts[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<number | null>(ex?.toAccountId ?? data.accounts[1]?.id ?? null);
  const [direction, setDirection] = useState<1 | -1>((ex?.direction as 1 | -1) ?? 1);
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveVoucherAction({
      id: ex?.id,
      type: data.type,
      date,
      amountPaise: toPaise(amount) || 0,
      accountId,
      toAccountId: transfer ? toAccountId : null,
      direction: transfer ? null : direction,
      notes: notes || null,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    router.push(`/cash-bank`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{transfer ? "Move money between accounts" : "Adjust cash or bank balance"}</h1>
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        {!transfer && (
          <Field label="Type" className="sm:col-span-2">
            <div className="flex gap-2">
              <Button variant={direction === 1 ? "primary" : "secondary"} onClick={() => setDirection(1)}>
                Add money
              </Button>
              <Button variant={direction === -1 ? "primary" : "secondary"} onClick={() => setDirection(-1)}>
                Take out money
              </Button>
            </div>
          </Field>
        )}
        <Field label={transfer ? "From" : "Account"}>
          <Select value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {transfer && (
          <Field label="To">
            <Select value={toAccountId ?? ""} onChange={(e) => setToAccountId(Number(e.target.value))}>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Amount (₹)">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="num" autoFocus />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note" className="sm:col-span-2" hint={transfer ? "e.g. Cash deposited in bank" : "e.g. Owner added capital, cash counted short"}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
