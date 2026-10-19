import "server-only";
import { checkGstin } from "@/lib/gst/gstin";
import type { EntryResult, apiReference } from "../api-v1";
import { esc, type InlineButton } from "./bot";
import type { ReadBill } from "./read-bill";

/*
 * Turning what was read off a bill into bookkeeping API entries (src/server/api-v1.ts), and the summary
 * the bot shows for approval. Plain code: suppliers are matched by GSTIN then name, items by Product ID
 * then name; anything unmatched becomes a new supplier / item placed before the bill in the same batch.
 */

type Reference = Awaited<ReturnType<typeof apiReference>>;
type Entry = Record<string, unknown> & { kind: string; ref: string };

export interface PlanLine {
  name: string;
  code: string | null;
  isNew: boolean;
  qty: number;
  unit: string | null;
  ratePaise: number;
  gstPct: number | null;
  discountPct: number;
}

export interface Plan {
  type: ReadBill["type"];
  supplier: { name: string; gstin: string | null; isNew: boolean } | null;
  billNo: string | null;
  date: string | null;
  dateGuessed: boolean;
  lines: PlanLine[];
  /** The total printed on the bill. */
  totalPaise: number | null;
  category: { name: string; isNew: boolean } | null;
  description: string | null;
  /** Reasons it can't be entered as it stands. */
  problems: string[];
  /** Things to look at that don't stop it. */
  notes: string[];
  entries: Entry[];
}

/** Lower case, punctuation and extra spaces removed: "M/s. Medi  Distributors" → "ms medi distributors". */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const paiseOf = (rupees: number) => Math.round(rupees * 100);

export function billRef(draftId: number) {
  return `tg-${draftId}`;
}

export function buildPlan(read: ReadBill, ref: Reference, draftId: number, today: string): Plan {
  const plan: Plan = {
    type: read.type,
    supplier: null,
    billNo: read.billNo,
    date: read.date ?? today,
    dateGuessed: !read.date,
    lines: [],
    totalPaise: read.total != null ? paiseOf(read.total) : null,
    category: null,
    description: read.description,
    problems: [],
    notes: [],
    entries: [],
  };
  if (read.type === "not_a_bill") {
    plan.problems.push(read.problem ?? "This doesn't look like a bill.");
    return plan;
  }
  if (read.problem) plan.notes.push(read.problem);
  if (plan.dateGuessed) plan.notes.push("No date could be read, so today's date is used.");
  else if (plan.date! > today) plan.notes.push("The date is in the future — check it.");

  // The supplier: existing by GSTIN, then by name; else a new one.
  let party: Record<string, unknown> | null = null;
  if (read.supplier?.name) {
    let gstin = read.supplier.gstin ? read.supplier.gstin.replace(/\s+/g, "").toUpperCase() : null;
    if (gstin && !checkGstin(gstin).ok) {
      plan.notes.push(`The GSTIN read (${gstin}) doesn't check out, so it's left out.`);
      gstin = null;
    }
    const suppliers = ref.parties.filter((p) => p.kind !== "customer");
    const hit = (gstin && ref.parties.find((p) => p.gstin?.toUpperCase() === gstin)) || suppliers.find((p) => norm(p.name) === norm(read.supplier!.name)) || ref.parties.find((p) => norm(p.name) === norm(read.supplier!.name));
    if (hit) {
      party = { id: hit.id };
      plan.supplier = { name: hit.name, gstin: hit.gstin, isNew: false };
    } else {
      plan.entries.push({ kind: "party", ref: "supplier", name: read.supplier.name.slice(0, 200), partyKind: "supplier", gstin, phone: read.supplier.phone?.slice(0, 30) ?? null, address: read.supplier.address });
      party = { ref: "supplier" };
      plan.supplier = { name: read.supplier.name, gstin, isNew: true };
    }
  }

  if (read.type === "expense") {
    if (plan.totalPaise == null || plan.totalPaise <= 0) plan.problems.push("Couldn't read the amount paid.");
    const cats = ref.categories.filter((c) => c.kind === "expense");
    const want = read.category ?? "General expenses";
    const cat = cats.find((c) => norm(c.name) === norm(want));
    plan.category = { name: cat?.name ?? want.slice(0, 120), isNew: !cat };
    // A supplier for an expense is just the payee's name; it isn't added as a party.
    plan.entries = [];
    if (plan.problems.length === 0) {
      plan.entries.push({
        kind: "expense",
        ref: billRef(draftId),
        date: plan.date,
        category: plan.category.name,
        amountPaise: plan.totalPaise,
        account: { name: "?" }, // chosen when the Owner taps Enter
        payee: plan.supplier?.name?.slice(0, 200) ?? null,
        paymentRef: read.billNo?.slice(0, 100) ?? null,
        note: [read.description, read.billNo ? `Bill ${read.billNo}` : null, "From Telegram"].filter(Boolean).join(" · "),
      });
    }
    return plan;
  }

  // A purchase bill.
  if (!party) plan.problems.push("Couldn't read the supplier's name.");
  if (!read.billNo) plan.problems.push("Couldn't read the bill number.");
  if (read.lines.length === 0) plan.problems.push("Couldn't read any product lines.");
  if (plan.totalPaise == null) plan.notes.push("No grand total could be read, so the app's total can't be checked against the bill.");

  const byCode = new Map(ref.items.filter((i) => i.code).map((i) => [i.code!.toLowerCase(), i]));
  const byName = new Map(ref.items.map((i) => [norm(i.name), i]));
  const newRefs = new Map<string, string>();
  const lines: Record<string, unknown>[] = [];
  for (const l of read.lines) {
    const hit = (l.matchedCode && byCode.get(l.matchedCode.toLowerCase())) || byName.get(norm(l.description));
    let item: Record<string, unknown>;
    if (hit) {
      item = { id: hit.id };
      plan.lines.push({ name: hit.name, code: hit.code, isNew: false, qty: l.qty, unit: l.unit ?? hit.unit, ratePaise: paiseOf(l.rate), gstPct: l.gstPct, discountPct: l.discountPct });
    } else {
      const key = norm(l.description);
      let r = newRefs.get(key);
      if (!r) {
        r = `item-${newRefs.size + 1}`;
        newRefs.set(key, r);
        plan.entries.push({
          kind: "item",
          ref: r,
          name: l.description.slice(0, 200),
          hsn: l.hsn?.replace(/\s+/g, "").slice(0, 10) || null,
          unit: l.unit?.slice(0, 30) || null,
          gstRatePct: l.gstPct,
          purchasePricePaise: paiseOf(l.rate),
        });
      }
      item = { ref: r };
      plan.lines.push({ name: l.description, code: null, isNew: true, qty: l.qty, unit: l.unit, ratePaise: paiseOf(l.rate), gstPct: l.gstPct, discountPct: l.discountPct });
    }
    lines.push({ item, qty: l.qty, ratePaise: paiseOf(l.rate), gstRatePct: l.gstPct, discountPct: l.discountPct });
  }

  if (plan.problems.length) {
    plan.entries = [];
    return plan;
  }
  plan.entries.push({
    kind: "purchase_bill",
    ref: billRef(draftId),
    date: plan.date,
    party,
    billNo: read.billNo!.slice(0, 60),
    lines,
    expectedTotalPaise: plan.totalPaise,
    roundOff: true,
    notes: "From Telegram",
  });
  return plan;
}

/** The entries to send once the Owner has said how it was paid (`accountId` null = not paid yet). */
export function withPayment(entries: Entry[], accountId: number | null, accountKind: "cash" | "bank" | null): Entry[] {
  return entries.map((e) => {
    if (e.kind === "purchase_bill") return { ...e, paidFrom: accountId ? { id: accountId } : null, paymentMode: accountId ? (accountKind === "bank" ? "Bank transfer" : "Cash") : null };
    if (e.kind === "expense") return { ...e, account: { id: accountId }, paymentMode: accountKind === "bank" ? "Bank transfer" : "Cash" };
    return e;
  });
}

// ─── The summary message ─────────────────────────────────────────────────────

export interface Check {
  ok: boolean;
  /** Problems reported by the dry run. */
  errors: string[];
  /** The bill's total as the app works it out. */
  appTotalPaise: number | null;
  duplicates: { number: string; date: string; amountPaise: number }[];
}

export function checkFrom(results: EntryResult[], draftId: number, error?: string): Check {
  const bill = results.find((r) => r.ref === billRef(draftId));
  return {
    ok: !error && results.length > 0 && results.every((r) => r.status !== "error"),
    errors: error ? [error] : results.filter((r) => r.status === "error").map((r) => r.message ?? "Something didn't fit."),
    appTotalPaise: bill?.totalPaise ?? null,
    duplicates: (bill?.possibleDuplicates ?? []).map((d) => ({ number: d.number, date: d.date, amountPaise: d.amountPaise })),
  };
}

export function money(p: number, country: string) {
  const v = (p / 100).toLocaleString(country === "SA" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return country === "SA" ? `SAR ${v}` : `₹${v}`;
}

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};

const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, ""));

export function summaryText(plan: Plan, check: Check | null, firmName: string, country: string): string {
  const out: string[] = [];
  const b = (s: string) => `<b>${esc(s)}</b>`;
  if (plan.type === "not_a_bill") {
    out.push(`🤔 ${b("Not read as a bill")}`, esc(plan.problems[0] ?? ""));
  } else if (plan.type === "expense") {
    out.push(`🧾 ${b("Expense")} · ${esc(firmName)}`);
    if (plan.category) out.push(`Category: ${b(plan.category.name)}${plan.category.isNew ? " (new category)" : ""}`);
    if (plan.supplier) out.push(`Paid to: ${esc(plan.supplier.name)}`);
    if (plan.description) out.push(esc(plan.description));
    out.push(`${plan.billNo ? `Bill ${esc(plan.billNo)} · ` : ""}${plan.date ? day(plan.date) : ""}`);
    if (plan.totalPaise != null) out.push(`Amount ${b(money(plan.totalPaise, country))}`);
  } else {
    out.push(`🧾 ${b("Purchase bill")} · ${esc(firmName)}`);
    if (plan.supplier) out.push(`Supplier: ${b(plan.supplier.name)}${plan.supplier.isNew ? ` (new supplier${plan.supplier.gstin ? ` · GSTIN ${esc(plan.supplier.gstin)}` : ""})` : ""}`);
    out.push(`${plan.billNo ? `Bill ${esc(plan.billNo)}` : "Bill no. ?"} · ${plan.date ? day(plan.date) : "date ?"}`);
    out.push("");
    plan.lines.forEach((l, i) => {
      const tag = l.isNew ? " <i>(new item)</i>" : l.code ? ` (#${esc(l.code)})` : "";
      const gst = l.gstPct != null ? ` + ${l.gstPct}% GST` : "";
      const disc = l.discountPct ? ` − ${l.discountPct}%` : "";
      out.push(`${i + 1}. ${esc(l.name)}${tag}\n    ${qtyText(l.qty)}${l.unit ? ` ${esc(l.unit)}` : ""} × ${money(l.ratePaise, country)}${disc}${gst}`);
    });
    out.push("");
    if (check?.ok && check.appTotalPaise != null) {
      out.push(`Total ${b(money(check.appTotalPaise, country))}${plan.totalPaise != null ? " ✓ matches the bill" : ""}`);
    } else if (plan.totalPaise != null) {
      out.push(`Total on the bill ${b(money(plan.totalPaise, country))}`);
    }
  }
  const warn = [...plan.problems.filter((p) => plan.type !== "not_a_bill" || p !== plan.problems[0]), ...(check?.errors ?? [])];
  if (warn.length) out.push("", ...warn.map((w) => `❌ ${esc(w)}`));
  if (plan.notes.length) out.push("", ...plan.notes.map((n) => `⚠️ ${esc(n)}`));
  for (const d of check?.duplicates ?? []) out.push(`⚠️ Looks like ${esc(d.number)} already entered (${day(d.date)}, ${money(d.amountPaise, country)})`);
  out.push("", check?.ok ? "Check it, then tap how it was paid. Reply to this message to correct anything." : "Reply to this message with a correction (e.g. “total is 742”), send a clearer photo, or discard.");
  return out.join("\n");
}

export function summaryButtons(draftId: number, plan: Plan, check: Check | null, accounts: { id: number; name: string; kind: "cash" | "bank" }[]): InlineButton[][] {
  const rows: InlineButton[][] = [];
  if (check?.ok) {
    if (plan.type === "purchase_bill") rows.push([{ text: "✅ Enter – not paid yet", callback_data: `e:${draftId}:0` }]);
    for (const a of accounts.slice(0, 4)) rows.push([{ text: `✅ Enter – paid from ${a.name}`.slice(0, 60), callback_data: `e:${draftId}:${a.id}` }]);
  }
  rows.push([{ text: "🗑 Discard", callback_data: `x:${draftId}` }]);
  return rows;
}
