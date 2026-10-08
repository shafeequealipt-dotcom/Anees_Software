"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addPromotionAction,
  payPartnerAction,
  removePromotionAction,
  saveViewsAction,
  savePartnerAction,
  savePayoutInvoiceAction,
  savePayoutSettingsAction,
  setPartnersEnabledAction,
  shareInvoiceAction,
  suggestInvoiceNoAction,
} from "@/app/actions/partners";
import { toPaise } from "@/lib/money";
import { viewsAmountPaise } from "@/lib/payout";
import { MODES, Popover, type AccountOpt } from "./staff";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, cx } from "./ui";

const rupees = (p: number | null | undefined) => (p ? String(p / 100) : "");
const num = (s: string) => Number(s.replace(/[,\s]/g, ""));
const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

// ─── Onboarding form ─────────────────────────────────────────────────────────

export interface PartnerValue {
  id?: number;
  code: string;
  name: string;
  channelName: string | null;
  handle: string | null;
  kind: string;
  country: string | null;
  address: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  telegram: string | null;
  tiktok: string | null;
  youtubeUrl: string | null;
  ratePerMillionPaise: number;
  bankHolder: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankBranch: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  bankSwift: string | null;
  bankIban: string | null;
  bankAddress: string | null;
  joinedOn: string | null;
  notes: string | null;
  active: boolean;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5 shadow-sm shadow-ink/[0.03]">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function PartnerForm({ initial, nextCode, defaultRatePaise }: { initial?: PartnerValue; nextCode: string; defaultRatePaise: number }) {
  const router = useRouter();
  const [v, setV] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    channelName: initial?.channelName ?? "",
    handle: initial?.handle ?? "",
    kind: initial?.kind ?? "national",
    country: initial?.country ?? "",
    address: initial?.address ?? "",
    pan: initial?.pan ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    instagram: initial?.instagram ?? "",
    facebook: initial?.facebook ?? "",
    telegram: initial?.telegram ?? "",
    tiktok: initial?.tiktok ?? "",
    youtubeUrl: initial?.youtubeUrl ?? "",
    rate: rupees(initial ? initial.ratePerMillionPaise : defaultRatePaise),
    bankHolder: initial?.bankHolder ?? "",
    bankName: initial?.bankName ?? "",
    bankAccountNo: initial?.bankAccountNo ?? "",
    bankBranch: initial?.bankBranch ?? "",
    bankIfsc: initial?.bankIfsc ?? "",
    upiId: initial?.upiId ?? "",
    bankSwift: initial?.bankSwift ?? "",
    bankIban: initial?.bankIban ?? "",
    bankAddress: initial?.bankAddress ?? "",
    joinedOn: initial?.joinedOn ?? "",
    notes: initial?.notes ?? "",
    active: initial?.active ?? true,
  });
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.msg : null);
  const intl = v.kind === "international";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const t = (s: string) => s || null;
    const res = await savePartnerAction({
      id: initial?.id,
      code: t(v.code),
      name: v.name,
      channelName: t(v.channelName),
      handle: t(v.handle),
      kind: v.kind as "national" | "international",
      country: t(v.country),
      address: t(v.address),
      pan: t(v.pan),
      phone: t(v.phone),
      email: t(v.email),
      instagram: t(v.instagram),
      facebook: t(v.facebook),
      telegram: t(v.telegram),
      tiktok: t(v.tiktok),
      youtubeUrl: t(v.youtubeUrl),
      ratePerMillionPaise: toPaise(v.rate) || 0,
      bankHolder: t(v.bankHolder),
      bankName: t(v.bankName),
      bankAccountNo: t(v.bankAccountNo),
      bankBranch: t(v.bankBranch),
      bankIfsc: t(v.bankIfsc),
      upiId: t(v.upiId),
      bankSwift: t(v.bankSwift),
      bankIban: t(v.bankIban),
      bankAddress: t(v.bankAddress),
      joinedOn: t(v.joinedOn),
      notes: t(v.notes),
      active: v.active,
    });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    router.push(`/partners/${res.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mx-auto flex max-w-3xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}

      <Section title="Who">
        <Field label="Type" hint="International partners get SWIFT and IBAN bank fields.">
          <Select value={v.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="national">National (India)</option>
            <option value="international">International</option>
          </Select>
        </Field>
        <Field label="Partner ID" error={err("code")} hint={initial ? "Shown on the partner list and sheet. Must be unique." : `Leave empty to get ${nextCode}.`}>
          <Input value={v.code} onChange={(e) => set("code", e.target.value)} placeholder={initial ? undefined : nextCode} maxLength={60} />
        </Field>
        <Field label="Name" error={err("name")} hint="The person we deal with.">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus={!initial} />
        </Field>
        <Field label="Channel name" hint="The invoice is made out to this.">
          <Input value={v.channelName} onChange={(e) => set("channelName", e.target.value)} />
        </Field>
        <Field label="Handle" hint="e.g. @dontmissbollywood">
          <Input value={v.handle} onChange={(e) => set("handle", e.target.value)} />
        </Field>
        {intl && (
          <Field label="Country" error={err("country")}>
            <Input value={v.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
        )}
        <Field label="PAN" hint={intl ? "If they have one." : undefined}>
          <Input value={v.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={20} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea value={v.address} onChange={(e) => set("address", e.target.value)} rows={2} />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Phone / WhatsApp" hint="Used to open their WhatsApp chat when sharing an invoice.">
          <Input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email" error={err("email")}>
          <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </Section>

      <Section title="Channels" hint="Where they publish.">
        <Field label="YouTube channel link" className="sm:col-span-2">
          <Input value={v.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} placeholder="https://youtube.com/@…" />
        </Field>
        <Field label="Instagram ID">
          <Input value={v.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@name" />
        </Field>
        <Field label="Facebook ID">
          <Input value={v.facebook} onChange={(e) => set("facebook", e.target.value)} />
        </Field>
        <Field label="Telegram">
          <Input value={v.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="@name" />
        </Field>
        <Field label="TikTok">
          <Input value={v.tiktok} onChange={(e) => set("tiktok", e.target.value)} placeholder="@name" />
        </Field>
      </Section>

      <Section title="Payment">
        <Field label="Rate per 10,00,000 views (₹)" error={err("ratePerMillionPaise")} hint="Used to work out each month's amount from their views. You can still change a month's rate.">
          <Input inputMode="decimal" value={v.rate} onChange={(e) => set("rate", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Joined on">
          <Input type="date" value={v.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} />
        </Field>
      </Section>

      <Section title="Bank details" hint={intl ? "International transfer details." : "For national transfers."}>
        <Field label="Account holder">
          <Input value={v.bankHolder} onChange={(e) => set("bankHolder", e.target.value)} />
        </Field>
        <Field label="Bank name">
          <Input value={v.bankName} onChange={(e) => set("bankName", e.target.value)} />
        </Field>
        <Field label="Account number">
          <Input value={v.bankAccountNo} onChange={(e) => set("bankAccountNo", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Branch">
          <Input value={v.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} />
        </Field>
        {intl ? (
          <>
            <Field label="SWIFT / BIC code">
              <Input value={v.bankSwift} onChange={(e) => set("bankSwift", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={15} />
            </Field>
            <Field label="IBAN">
              <Input value={v.bankIban} onChange={(e) => set("bankIban", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={40} />
            </Field>
            <Field label="Bank address" className="sm:col-span-2">
              <Textarea value={v.bankAddress} onChange={(e) => set("bankAddress", e.target.value)} rows={2} />
            </Field>
          </>
        ) : (
          <>
            <Field label="IFSC">
              <Input value={v.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={15} />
            </Field>
            <Field label="UPI ID">
              <Input value={v.upiId} onChange={(e) => set("upiId", e.target.value)} placeholder="name@bank" />
            </Field>
          </>
        )}
      </Section>

      <Section title="Notes">
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Agreement terms, anything worth remembering" />
        </Field>
        {initial && <Checkbox label="Currently a partner" checked={v.active} onChange={(e) => set("active", e.target.checked)} className="sm:col-span-2" />}
      </Section>

      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add partner"}
        </Button>
      </div>
    </form>
  );
}

// ─── Month sheet: views, promotions, payment ────────────────────────────────

/** The views cell: click to enter this month's views, the rate and the amount. */
export function ViewsButton({ partnerId, name, month, monthLabel, views, rateUsedPaise, viewsAmountPaise: amountPaise, display }: { partnerId: number; name: string; month: string; monthLabel: string; views: number; rateUsedPaise: number; viewsAmountPaise: number; display: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vw, setVw] = useState(views ? String(views) : "");
  const [rate, setRate] = useState(rupees(rateUsedPaise));
  const [amount, setAmount] = useState(rupees(amountPaise));
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const worked = viewsAmountPaise(num(vw) || 0, toPaise(rate) || 0);
  const shown = manual ? amount : String(worked / 100);

  function show() {
    setVw(views ? String(views) : "");
    setRate(rupees(rateUsedPaise));
    setAmount(rupees(amountPaise));
    setManual(false);
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const n = num(vw);
    if (!Number.isInteger(n) || n < 0) {
      setBusy(false);
      return setError("Enter the views as a whole number.");
    }
    const res = await saveViewsAction({ partnerId, month, views: n, ratePerMillionPaise: toPaise(rate) || 0, amountPaise: manual ? toPaise(amount) || 0 : worked });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => (open ? setOpen(false) : show())} className="rounded-md px-1.5 py-0.5 text-right hover:bg-brand-50" title="Enter this month's views">
        {display}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="left" sheetOnPhone>
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div>
            <div className="text-sm font-semibold text-ink">{name}</div>
            <div className="text-xs text-muted">Views for {monthLabel}</div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Total views">
            <Input inputMode="numeric" value={vw} onChange={(e) => setVw(e.target.value)} autoFocus placeholder="42500000" />
          </Field>
          <Field label="Rate per 10,00,000 views (₹)">
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Amount for views (₹)" hint={manual ? "Changed by hand." : "Views × rate, to the nearest rupee. Change it if needed."}>
            <Input
              inputMode="decimal"
              value={shown}
              onChange={(e) => {
                setAmount(e.target.value);
                setManual(true);
              }}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      </Popover>
    </div>
  );
}

/** The promotions cell: the month's total, and a list to add to or remove from. */
export function PromotionsButton({ partnerId, name, month, monthLabel, promotions, display }: { partnerId: number; name: string; month: string; monthLabel: string; promotions: { id: number; description: string; amountPaise: number }[]; display: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await addPromotionAction({ partnerId, month, description: desc, amountPaise: toPaise(amount) || 0 });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDesc("");
    setAmount("");
    router.refresh();
  }

  async function remove(id: number) {
    setBusy(true);
    const res = await removePromotionAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => (setError(null), setOpen((o) => !o))} className="rounded-md px-1.5 py-0.5 text-right hover:bg-brand-50" title="Add or remove promotions">
        {display}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} sheetOnPhone>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="text-sm font-semibold text-ink">Promotions · {name}</div>
            <div className="text-xs text-muted">Extra amounts for {monthLabel}</div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
          {promotions.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {promotions.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-ground px-2 py-1">
                  <span className="min-w-0 truncate">{p.description}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="num">{inr(p.amountPaise)}</span>
                    <button type="button" disabled={busy} onClick={() => remove(p.id)} className="text-muted hover:text-bad" aria-label={`Remove ${p.description}`}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={add} className="flex flex-col gap-2 border-t border-line pt-2.5">
            <Field label="Promotion">
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Instagram reel campaign" autoFocus={promotions.length === 0} />
            </Field>
            <Field label="Amount (₹)">
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15000" />
            </Field>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Add promotion"}
            </Button>
          </form>
        </div>
      </Popover>
    </div>
  );
}

/** "Pay" for one partner and month. */
export function PayPartnerButton({ partnerId, name, month, monthLabel, dueLabel, suggestPaise, accounts, defaultAccountId, today }: { partnerId: number; name: string; month: string; monthLabel: string; dueLabel: string; suggestPaise: number; accounts: AccountOpt[]; defaultAccountId: number | null; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(rupees(suggestPaise));
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState<number | null>(defaultAccountId);
  const [mode, setMode] = useState("Bank transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await payPartnerAction({ partnerId, month, amountPaise: toPaise(amount) || 0, date, accountId: accountId ?? 0, paymentMode: mode, note: note || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    setNote("");
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setAmount(rupees(suggestPaise));
          setError(null);
          setOpen((o) => !o);
        }}
      >
        Pay
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} sheetOnPhone>
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div>
            <div className="text-sm font-semibold text-ink">Pay {name}</div>
            <div className="text-xs text-muted">
              {monthLabel} · {dueLabel} due
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
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Record payment"}
          </Button>
        </form>
      </Popover>
    </div>
  );
}

// ─── Payout invoice ──────────────────────────────────────────────────────────

/**
 * Shares a saved invoice on WhatsApp. On a phone the PDF itself goes through the share sheet; on a
 * computer WhatsApp Web opens on the partner's chat with a message and a private link (a website
 * can't attach a file to WhatsApp Web). Opens its tab before the server call so it isn't blocked.
 */
const canShareFiles = () => typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "x.pdf", { type: "application/pdf" })] });

/** A blank tab for WhatsApp Web, opened straight from the click (a tab opened after waiting on the server gets blocked). Phones share a file instead, so need none. */
function openShareTab(): Window | null {
  if (canShareFiles()) return null;
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return tab;
}

async function shareOnWhatsApp(payoutId: number, preOpened?: Window | null): Promise<string | null> {
  const canFiles = canShareFiles();
  const tab = canFiles ? null : (preOpened ?? openShareTab());
  const res = await shareInvoiceAction(payoutId);
  if (!res.ok) {
    tab?.close();
    return res.error;
  }
  if (canFiles) {
    try {
      const blob = await (await fetch(res.pdfUrl)).blob();
      const file = new File([blob], "payout-invoice.pdf", { type: "application/pdf" });
      await navigator.share({ files: [file], text: res.text });
      return null;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null; // they closed the share sheet
      window.open(res.web, "_blank");
      return null;
    }
  }
  if (tab) tab.location.href = res.web;
  else window.open(res.web, "_blank");
  return res.hasPhone ? null : "That partner has no phone number saved, so pick the chat in WhatsApp.";
}

/** For an invoice that's already made: share it again from the sheet. */
export function ShareInvoiceButton({ payoutId }: { payoutId: number }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={busy}
        className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-60"
        onClick={async () => {
          const tab = openShareTab();
          setBusy(true);
          setNote(await shareOnWhatsApp(payoutId, tab));
          setBusy(false);
        }}
      >
        {busy ? "Opening…" : "WhatsApp"}
      </button>
      {note && <span className="max-w-40 text-[11px] text-muted">{note}</span>}
    </span>
  );
}

export function InvoiceButton({
  partnerId,
  name,
  month,
  monthLabel,
  existing,
  defaults,
  disabled,
}: {
  partnerId: number;
  name: string;
  month: string;
  monthLabel: string;
  existing: { payoutId: number; invoiceNo: string } | null;
  defaults: { date: string; period: string; description: string; notes: string };
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState(existing?.invoiceNo ?? "");
  const [date, setDate] = useState(defaults.date);
  const [period, setPeriod] = useState(defaults.period);
  const [desc, setDesc] = useState(defaults.description);
  const [notes, setNotes] = useState(defaults.notes);
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function show() {
    setError(null);
    setInfo(null);
    setOpen(true);
    if (!existing && !no) {
      const s = await suggestInvoiceNoAction(date);
      if (s.ok) setNo(s.invoiceNo);
    }
  }

  async function save() {
    const res = await savePayoutInvoiceAction({ partnerId, month, invoiceNo: no || null, date, period: period || null, description: desc || null, notes: notes || null });
    if (!res.ok) {
      setError({ msg: res.error, field: res.field });
      return null;
    }
    setNo(res.invoiceNo);
    return res;
  }

  async function saveAndDownload() {
    setBusy("save");
    setError(null);
    setInfo(null);
    const res = await save();
    setBusy(null);
    if (!res) return;
    const a = document.createElement("a");
    a.href = `/api/partners/payouts/${res.payoutId}/pdf?download=1`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setInfo(`Saved as ${res.invoiceNo}.`);
    router.refresh();
  }

  async function saveAndShare() {
    setBusy("share");
    setError(null);
    setInfo(null);
    // Open the WhatsApp tab now, inside the click, or the browser will block it after the save.
    const tab = openShareTab();
    const res = await save();
    if (!res) {
      tab?.close();
      setBusy(null);
      return;
    }
    const note = await shareOnWhatsApp(res.payoutId, tab);
    setBusy(null);
    setInfo(note ?? `Saved as ${res.invoiceNo}.`);
    router.refresh();
  }

  const err = (f: string) => (error?.field === f ? error.msg : null);
  return (
    <div className="relative inline-block">
      <Button size="sm" variant={existing ? "ghost" : "secondary"} disabled={disabled} onClick={() => (open ? setOpen(false) : show())} title={disabled ? "Enter views or add a promotion first" : undefined}>
        {existing ? "Edit invoice" : "Invoice"}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} width="w-[22rem]" sheetOnPhone>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="text-sm font-semibold text-ink">Payout invoice · {name}</div>
            <div className="text-xs text-muted">For {monthLabel}</div>
          </div>
          {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            <Field label="Invoice no." error={err("invoiceNo")}>
              <Input value={no} onChange={(e) => setNo(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Period covered">
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <Field label="Views line">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Notes / payment terms">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
          {info && <Alert tone="good">{info}</Alert>}
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            <Button variant="primary" disabled={busy !== null} onClick={saveAndDownload}>
              {busy === "save" ? "Saving…" : "Save & download"}
            </Button>
            <Button disabled={busy !== null} onClick={saveAndShare}>
              {busy === "share" ? "Opening…" : "Share on WhatsApp"}
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface PayoutSettingsValue {
  payoutPrefix: string;
  payoutLlpin: string;
  payoutTan: string;
  payoutSignerName: string;
  payoutSignerRole: string;
  payoutShowSignature: boolean;
  payoutRatePerMillionPaise: number;
  payoutViewsDescription: string;
  payoutNotes: string;
}

export function PayoutSettingsForm({ initial }: { initial: PayoutSettingsValue }) {
  const router = useRouter();
  const [v, setV] = useState({ ...initial, rate: rupees(initial.payoutRatePerMillionPaise) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (msg && !msg.ok && msg.field === f ? msg.text : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await savePayoutSettingsAction({
      payoutPrefix: v.payoutPrefix,
      payoutLlpin: v.payoutLlpin,
      payoutTan: v.payoutTan,
      payoutSignerName: v.payoutSignerName,
      payoutSignerRole: v.payoutSignerRole,
      payoutShowSignature: v.payoutShowSignature,
      payoutRatePerMillionPaise: toPaise(v.rate) || 0,
      payoutViewsDescription: v.payoutViewsDescription,
      payoutNotes: v.payoutNotes,
    });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error, field: res.field });
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <p className="text-sm text-muted sm:col-span-2">
        The company name, address, PAN, GSTIN, email, phone, logo and signature on the invoice come from <b>Settings → This company</b>. These are the extra details only payout invoices need.
      </p>
      {msg && !msg.field && <div className="sm:col-span-2"><Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert></div>}
      <Field label="Invoice number prefix" error={err("payoutPrefix")} hint="Numbers look like ORP/2026-27/001.">
        <Input value={v.payoutPrefix} onChange={(e) => set("payoutPrefix", e.target.value)} className="font-mono" maxLength={12} />
      </Field>
      <Field label="Usual rate per 10,00,000 views (₹)" hint="Filled in for each new partner.">
        <Input inputMode="decimal" value={v.rate} onChange={(e) => set("rate", e.target.value)} />
      </Field>
      <Field label="LLPIN">
        <Input value={v.payoutLlpin} onChange={(e) => set("payoutLlpin", e.target.value)} className="font-mono" />
      </Field>
      <Field label="TAN">
        <Input value={v.payoutTan} onChange={(e) => set("payoutTan", e.target.value.toUpperCase())} className="font-mono uppercase" />
      </Field>
      <Field label="Signatory name">
        <Input value={v.payoutSignerName} onChange={(e) => set("payoutSignerName", e.target.value)} />
      </Field>
      <Field label="Signatory role">
        <Input value={v.payoutSignerRole} onChange={(e) => set("payoutSignerRole", e.target.value)} />
      </Field>
      <Field label="Usual wording for the views line" error={err("payoutViewsDescription")} className="sm:col-span-2">
        <Input value={v.payoutViewsDescription} onChange={(e) => set("payoutViewsDescription", e.target.value)} />
      </Field>
      <Field label="Usual notes / payment terms" className="sm:col-span-2">
        <Textarea value={v.payoutNotes} onChange={(e) => set("payoutNotes", e.target.value)} rows={3} />
      </Field>
      <Checkbox label="Print the signature image on invoices" checked={v.payoutShowSignature} onChange={(e) => set("payoutShowSignature", e.target.checked)} className="sm:col-span-2" />
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {msg?.ok && <span className="text-sm text-good">Saved.</span>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

// ─── Companies screen switch ─────────────────────────────────────────────────

/** Owner-only: turn the Partners section on or off for one company. */
export function PartnersSwitch({ firmId, enabled }: { firmId: number; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", busy && "opacity-60")}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError(null);
            const res = await setPartnersEnabledAction(firmId, e.target.checked);
            setBusy(false);
            if (!res.ok) return setError(res.error);
            router.refresh();
          }}
        />
        <span>{enabled ? "On" : "Off"}</span>
      </label>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
