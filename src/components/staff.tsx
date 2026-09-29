"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { payEmployeeAction, saveEmployeeAction, saveSalaryAdjustmentAction } from "@/app/actions/staff";
import { toPaise } from "@/lib/money";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, cx } from "./ui";

const rupees = (p: number | null | undefined) => (p ? String(p / 100) : "");

/** A small panel that opens under its button on click and closes on an outside click or Escape. */
function Popover({ open, onClose, children, align = "right" }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Deferred so the click that opened it doesn't immediately count as an outside click.
    const t = setTimeout(() => document.addEventListener("pointerdown", down));
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={cx("absolute top-full z-40 mt-1.5 w-72 rounded-xl border border-line bg-panel p-3 text-left shadow-lg shadow-ink/10", align === "right" ? "right-0" : "left-0")}>
      {children}
    </div>
  );
}

export interface AccountOpt {
  id: number;
  name: string;
}

const MODES = ["Cash", "UPI", "Bank transfer", "Cheque"];

/** "Pay" (salary) or "Advance" for one employee and month. */
export function PayButton({
  employeeId,
  name,
  month,
  monthLabel,
  kind,
  suggestPaise,
  dueLabel,
  accounts,
  defaultAccountId,
  today,
  label,
  variant = "secondary",
  align,
}: {
  employeeId: number;
  name: string;
  month: string;
  monthLabel: string;
  kind: "salary" | "advance";
  suggestPaise: number;
  dueLabel?: string;
  accounts: AccountOpt[];
  defaultAccountId: number | null;
  today: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  align?: "left" | "right";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(rupees(suggestPaise));
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState<number | null>(defaultAccountId);
  const [mode, setMode] = useState(accounts.find((a) => a.id === defaultAccountId)?.name.toLowerCase().includes("cash") ? "Cash" : "Bank transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function show() {
    setAmount(rupees(suggestPaise));
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await payEmployeeAction({ employeeId, month, kind, amountPaise: toPaise(amount) || 0, date, accountId: accountId ?? 0, paymentMode: mode, note: note || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    setNote("");
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <Button size="sm" variant={variant} onClick={() => (open ? setOpen(false) : show())}>
        {label}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} align={align}>
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div>
            <div className="text-sm font-semibold text-ink">{kind === "advance" ? `Advance to ${name}` : `Pay ${name}`}</div>
            <div className="text-xs text-muted">
              {kind === "advance" ? `Taken off the ${monthLabel} salary` : `Salary for ${monthLabel}`}
              {dueLabel ? ` · ${dueLabel} due` : ""}
            </div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Amount">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Paid from">
            <Select value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "advance" ? "e.g. for rent" : ""} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : kind === "advance" ? "Give advance" : "Record payment"}
          </Button>
        </form>
      </Popover>
    </div>
  );
}

/** The "+ extra / − deduction" cell: click to change this month's bonus, overtime or leave deduction. */
export function AdjustButton({ employeeId, month, extraPaise, deductionPaise, note, display }: { employeeId: number; month: string; extraPaise: number; deductionPaise: number; note: string | null; display: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(rupees(extraPaise));
  const [deduction, setDeduction] = useState(rupees(deductionPaise));
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await saveSalaryAdjustmentAction({ employeeId, month, extraPaise: toPaise(extra) || 0, deductionPaise: toPaise(deduction) || 0, note: text || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setExtra(rupees(extraPaise));
          setDeduction(rupees(deductionPaise));
          setText(note ?? "");
          setError(null);
          setOpen((o) => !o);
        }}
        className="rounded-md px-1.5 py-0.5 text-right hover:bg-brand-50"
        title={note ?? "Add extra pay or a deduction"}
      >
        {display}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div className="text-sm font-semibold text-ink">Extra pay and deductions</div>
          {error && <Alert tone="bad">{error}</Alert>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Extra (bonus, overtime)">
              <Input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" autoFocus />
            </Field>
            <Field label="Deduction (leave)">
              <Input inputMode="decimal" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Reason (optional)">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2 days unpaid leave" />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      </Popover>
    </div>
  );
}

export interface EmployeeValue {
  id?: number;
  name: string;
  phone: string | null;
  role: string | null;
  locationId: number | null;
  monthlySalaryPaise: number;
  joinedOn: string | null;
  leftOn: string | null;
  notes: string | null;
  active: boolean;
}

export function EmployeeForm({ initial, locations }: { initial?: EmployeeValue; locations: { id: number; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    role: initial?.role ?? "",
    locationId: initial?.locationId ?? null,
    salary: rupees(initial?.monthlySalaryPaise),
    joinedOn: initial?.joinedOn ?? "",
    leftOn: initial?.leftOn ?? "",
    notes: initial?.notes ?? "",
    active: initial?.active ?? true,
  });
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.msg : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveEmployeeAction({
      id: initial?.id,
      name: v.name,
      phone: v.phone || null,
      role: v.role || null,
      locationId: v.locationId,
      monthlySalaryPaise: toPaise(v.salary) || 0,
      joinedOn: v.joinedOn || null,
      leftOn: v.leftOn || null,
      notes: v.notes || null,
      // Someone with a leaving date has left: stop listing them for future months.
      active: v.leftOn ? false : v.active,
    });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    router.push(`/staff/${res.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mx-auto flex max-w-xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      <div className="grid gap-4 rounded-xl border border-line bg-panel p-5 shadow-sm shadow-ink/[0.03] sm:grid-cols-2">
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus={!initial} />
        </Field>
        <Field label="Job" hint="e.g. Cashier, Delivery, Helper">
          <Input value={v.role} onChange={(e) => set("role", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Monthly salary" error={err("monthlySalaryPaise")}>
          <Input inputMode="decimal" value={v.salary} onChange={(e) => set("salary", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Works at" hint="Their salary counts as this shop's cost.">
          <Select value={v.locationId ?? ""} onChange={(e) => set("locationId", e.target.value ? Number(e.target.value) : null)}>
            <option value="">Whole business</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Joined on">
          <Input type="date" value={v.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} />
        </Field>
        <Field label="Left on" error={err("leftOn")} hint={initial ? "Fill this in when they leave." : undefined}>
          <Input type="date" value={v.leftOn} onChange={(e) => set("leftOn", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Bank account, ID proof, anything worth remembering" />
        </Field>
        {initial && !v.leftOn && <Checkbox label="Currently working here" checked={v.active} onChange={(e) => set("active", e.target.checked)} className="sm:col-span-2" />}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add employee"}
        </Button>
      </div>
    </form>
  );
}
