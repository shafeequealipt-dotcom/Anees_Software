"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quickPartyAction, saveVoucherAction } from "@/app/actions/vouchers";
import { calculateVoucher, supplyFor } from "@/lib/gst/engine";
import { region, taxColumnLabels } from "@/lib/region";
import { GST_STATES, stateName } from "@/lib/gst/states";
import { formatINR, formatQty, toBasisPoints, toMilli, toPaise } from "@/lib/money";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import type { ItemOpt, PartyOpt, VoucherFormData } from "@/server/form-data";
import { Combobox } from "./combobox";
import { Alert, Button, Checkbox, cx, Field, Input, Money, PartyBalance, Select, Textarea } from "./ui";
import { saleRateFor } from "@/lib/pricing";

interface Line {
  key: string;
  itemId: number | null;
  description: string;
  hsn: string;
  qty: string;
  unit: "base" | "alt";
  rate: string;
  rateIncl: boolean;
  discPct: string;
  taxRateId: number | null;
  gstBp: number;
  cessBp: number;
  mrp: string;
  batchNo: string;
  expiryDate: string;
}

const PAYMENT_MODES = ["Cash", "UPI", "Bank transfer", "Card", "Cheque"];
// Line keys only need to be unique within one form. Initial lines use their index so server and
// browser render identical HTML; lines added later use a random suffix.
const newKey = () => `n${Math.random().toString(36).slice(2, 10)}`;
const rupees = (p: number | null | undefined) => (p ? (p / 100).toFixed(2).replace(/\.00$/, "") : "");

function blankLine(defaultIncl: boolean, key = newKey()): Line {
  return { key, itemId: null, description: "", hsn: "", qty: "1", unit: "base", rate: "", rateIncl: defaultIncl, discPct: "", taxRateId: null, gstBp: 0, cessBp: 0, mrp: "", batchNo: "", expiryDate: "" };
}

export function VoucherForm({ data }: { data: VoucherFormData }) {
  const router = useRouter();
  const info = VOUCHER_INFO[data.type];
  const ex = data.existing?.voucher;
  const src = data.source;
  const base = ex ?? src?.voucher ?? null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: region().timezone }).format(new Date());

  const [parties, setParties] = useState<PartyOpt[]>(data.parties);
  const [partyId, setPartyId] = useState<number | null>(base?.partyId ?? data.presetPartyId ?? null);
  const [partyName, setPartyName] = useState(base?.partyId ? "" : (base?.partyName ?? ""));
  const [partyPhone, setPartyPhone] = useState(base?.partyId ? "" : (base?.partyPhone ?? ""));
  const [date, setDate] = useState(ex?.date ?? today);
  const [dueDate, setDueDate] = useState(ex?.dueDate ?? "");
  const [number, setNumber] = useState(ex ? String(ex.number) : "");
  const [placeOfSupply, setPlaceOfSupply] = useState(base?.placeOfSupply ?? "");
  const [billingAddress, setBillingAddress] = useState(base?.billingAddress ?? "");
  const [shippingAddress, setShippingAddress] = useState(base?.shippingAddress ?? "");
  const [reverseCharge, setReverseCharge] = useState(base?.reverseCharge ?? false);
  const [itcEligible, setItcEligible] = useState(ex?.itcEligible ?? true);
  const [withoutTax, setWithoutTax] = useState(ex?.withoutTax ?? false);
  const [billDiscPct, setBillDiscPct] = useState(base?.billDiscountBp ? String(base.billDiscountBp / 100) : "");
  const [billDiscAmt, setBillDiscAmt] = useState(base?.billDiscountPaise ? rupees(base.billDiscountPaise) : "");
  const [roundOff, setRoundOff] = useState(ex ? ex.roundOffPaise !== 0 || data.settings.roundOff : data.settings.roundOff);
  const [paid, setPaid] = useState(ex && info.takesPayment ? rupees(ex.paidPaise) : "");
  const [fullyPaid, setFullyPaid] = useState(false);
  const [tcsPct, setTcsPct] = useState(ex?.tcsBp ? String(ex.tcsBp / 100) : "");
  const [tdsPct, setTdsPct] = useState(ex?.tdsBp ? String(ex.tdsBp / 100) : "");
  const defaultAccount = data.accounts.find((a) => a.kind === "cash" && a.isDefault) ?? data.accounts[0];
  const [accountId, setAccountId] = useState<number | null>(ex?.accountId ?? defaultAccount?.id ?? null);
  const [paymentMode, setPaymentMode] = useState(ex?.paymentMode ?? "Cash");
  const [paymentRef, setPaymentRef] = useState(ex?.paymentRef ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(ex?.categoryId ?? null);
  const [direction, setDirection] = useState<1 | -1>((ex?.direction as 1 | -1) ?? 1);
  const [notes, setNotes] = useState(ex?.notes ?? (data.sourceRefs.length > 1 ? `Combined from ${data.sourceRefs.map((r) => r.label).join(", ")}` : ""));
  const [terms, setTerms] = useState(ex?.terms ?? (data.type === "quotation" ? data.settings.quotationTerms : info.outward && info.takesPayment ? (data.firm?.terms ?? "") : ""));
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(ex?.supplierInvoiceNo ?? "");
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState(ex?.originalInvoiceNo ?? (src && ["credit_note", "debit_note"].includes(data.type) ? `${src.voucher.prefix}${src.voucher.number}` : ""));
  const [originalInvoiceDate, setOriginalInvoiceDate] = useState(ex?.originalInvoiceDate ?? (src && ["credit_note", "debit_note"].includes(data.type) ? src.voucher.date : ""));
  const [poNumber, setPoNumber] = useState(base?.poNumber ?? "");
  const [ewayBillNo, setEwayBillNo] = useState(ex?.ewayBillNo ?? "");
  const [vehicleNo, setVehicleNo] = useState(ex?.vehicleNo ?? "");
  const [transportName, setTransportName] = useState(ex?.transportName ?? "");
  const [showMore, setShowMore] = useState(!!(ex?.ewayBillNo || ex?.vehicleNo || ex?.poNumber || ex?.shippingAddress));

  const itemMap = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const taxMap = useMemo(() => new Map(data.taxes.map((t) => [t.id, t])), [data.taxes]);

  const [lines, setLines] = useState<Line[]>(() => {
    const srcLines = data.existing?.lines ?? data.source?.lines ?? [];
    if (!srcLines.length) return [blankLine(data.settings.defaultPriceIncludesTax, "i0")];
    return srcLines.map((l, i) => {
      const item = l.itemId ? itemMap.get(l.itemId) : undefined;
      const isAlt = !!item?.altFactorMilli && l.unitFactorMilli === item.altFactorMilli && l.unitFactorMilli !== 1000;
      return {
        key: `i${i}`,
        itemId: l.itemId,
        description: l.description,
        hsn: l.hsn ?? "",
        qty: formatQty(l.qtyMilli),
        unit: isAlt ? "alt" : "base",
        rate: rupees(l.ratePaise) || "0",
        rateIncl: l.rateIncludesTax,
        discPct: l.discountBp ? String(l.discountBp / 100) : "",
        taxRateId: l.taxRateId,
        gstBp: l.gstBp,
        cessBp: l.cessBp,
        mrp: rupees(l.mrpPaise),
        batchNo: l.batchNo ?? "",
        expiryDate: l.expiryDate ?? "",
      };
    });
  });

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [addingParty, setAddingParty] = useState<string | null>(null);

  const party = partyId ? parties.find((p) => p.id === partyId) ?? null : null;
  const priceParty = party ? { id: party.id, priceListId: party.priceListId } : null;

  // On a new sale bill, switching the customer re-prices lines that still carry the previous customer's default price.
  const prevParty = useRef(priceParty);
  useEffect(() => {
    const before = prevParty.current;
    prevParty.current = priceParty;
    if (info.priceSide !== "sale" || ex || (before?.id ?? null) === (priceParty?.id ?? null)) return;
    setLines((ls) =>
      ls.map((l) => {
        const it = l.itemId ? itemMap.get(l.itemId) : undefined;
        if (!it) return l;
        const old = saleRateFor(it, before, data.pricing);
        if (l.rate !== (rupees(old.paise) || "")) return l;
        const next = saleRateFor(it, priceParty, data.pricing);
        return { ...l, rate: rupees(next.paise) || "", rateIncl: next.incl };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceParty?.id]);
  const pos = placeOfSupply || party?.stateCode || data.firm?.stateCode || "";
  const supply = supplyFor(data.firm?.country, data.firm?.stateCode, pos);
  const R = region();
  const TL = taxColumnLabels(R);
  const composition = data.firm?.gstScheme !== "regular" && info.outward;
  const noTax = data.type === "stock_adjustment" || data.type === "delivery_challan" || withoutTax || composition;

  // Fill party details when a party is picked (new vouchers only)
  const pickParty = useCallback(
    (p: PartyOpt | null) => {
      setPartyId(p?.id ?? null);
      if (p) {
        setBillingAddress(p.billingAddress ?? "");
        setShippingAddress(p.shippingAddress ?? "");
        setPlaceOfSupply("");
        if (p.creditDays && ["sale_invoice", "purchase_bill"].includes(data.type)) {
          const d = new Date(date + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + p.creditDays);
          setDueDate(d.toISOString().slice(0, 10));
        }
      }
    },
    [data.type, date],
  );

  const calc = useMemo(
    () =>
      calculateVoucher({
        supply,
        roundOff: data.type === "stock_adjustment" ? false : roundOff,
        withoutTax: noTax,
        billDiscountBp: billDiscPct ? toBasisPoints(billDiscPct) || undefined : undefined,
        billDiscountPaise: billDiscPct ? undefined : toPaise(billDiscAmt) || 0,
        lines: lines.map((l) => ({
          qtyMilli: Number.isNaN(toMilli(l.qty)) ? 0 : toMilli(l.qty),
          ratePaise: Number.isNaN(toPaise(l.rate)) ? 0 : toPaise(l.rate),
          rateIncludesTax: l.rateIncl,
          discountBp: Number.isNaN(toBasisPoints(l.discPct)) ? 0 : toBasisPoints(l.discPct),
          gstBp: l.gstBp,
          cessBp: l.cessBp,
        })),
      }),
    [lines, supply, roundOff, noTax, billDiscPct, billDiscAmt, data.type],
  );

  const showTds = data.settings.tdsTcsEnabled && data.firm?.country === "IN";
  const tcsAllowed = showTds && data.type === "sale_invoice";
  const tdsAllowed = showTds && !!partyId && ["sale_invoice", "purchase_bill", "expense"].includes(data.type);
  const tcsBp = tcsAllowed ? Math.max(0, toBasisPoints(tcsPct) || 0) : 0;
  const tdsBp = tdsAllowed ? Math.max(0, toBasisPoints(tdsPct) || 0) : 0;
  const tcsPaise = Math.round(((calc.taxablePaise + calc.cgstPaise + calc.sgstPaise + calc.igstPaise + calc.cessPaise) * tcsBp) / 10000);
  const tdsPaise = Math.round((calc.taxablePaise * tdsBp) / 10000);
  const total = calc.totalPaise + tcsPaise;
  const payable = total - tdsPaise;
  const paidPaise = !partyId ? total : fullyPaid ? payable : Math.min(Math.max(0, toPaise(paid) || 0), payable);
  const balance = payable - paidPaise;

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: string, item: ItemOpt | null, text?: string) {
    if (!item) {
      updateLine(key, { itemId: null, description: text ?? "" });
      return;
    }
    const sale = info.priceSide === "sale";
    const tax = item.taxRateId ? taxMap.get(item.taxRateId) : undefined;
    const price = sale ? saleRateFor(item, priceParty, data.pricing) : { paise: item.purchasePricePaise, incl: item.purchaseIncl };
    updateLine(key, {
      itemId: item.id,
      description: item.name,
      hsn: item.hsn ?? "",
      unit: "base",
      rate: rupees(price.paise) || "",
      rateIncl: price.incl,
      taxRateId: item.taxRateId,
      gstBp: tax?.gstBp ?? 0,
      cessBp: tax?.cessBp ?? 0,
      mrp: rupees(item.mrpPaise),
    });
    setLines((ls) => (ls[ls.length - 1].key === key ? [...ls, blankLine(data.settings.defaultPriceIncludesTax)] : ls));
    // Move straight to quantity so fast typists don't type into the item box.
    const qty = document.getElementById(`qty-${key}`) as HTMLInputElement | null;
    qty?.focus();
    qty?.select();
  }

  const save = useCallback(
    async (after: "view" | "new" | "print") => {
      setError(null);
      setWarnings([]);
      const usedLines = info.hasLines ? lines.filter((l) => l.itemId || l.description.trim()) : [];
      for (const l of usedLines) {
        if (Number.isNaN(toMilli(l.qty)) || Number.isNaN(toPaise(l.rate)) || Number.isNaN(toBasisPoints(l.discPct))) {
          setError(`Check the numbers on the line “${l.description}”.`);
          return;
        }
      }
      setSaving(true);
      const res = await saveVoucherAction({
        id: ex?.id,
        type: data.type,
        number: number && Number(number) !== ex?.number ? Number(number) : ex?.number,
        date,
        dueDate: dueDate || null,
        partyId,
        partyName: partyId ? null : partyName || null,
        partyPhone: partyId ? null : partyPhone || null,
        billingAddress: billingAddress || null,
        shippingAddress: shippingAddress || null,
        placeOfSupply: placeOfSupply || null,
        reverseCharge,
        itcEligible: data.type === "expense" ? itcEligible : true,
        tcsBp,
        tdsBp,
        withoutTax,
        billDiscountBp: billDiscPct ? toBasisPoints(billDiscPct) || 0 : 0,
        billDiscountPaise: billDiscPct ? 0 : toPaise(billDiscAmt) || 0,
        roundOff,
        paidPaise,
        accountId: paidPaise > 0 || data.type === "expense" ? accountId : null,
        paymentMode: paidPaise > 0 ? paymentMode : null,
        paymentRef: paidPaise > 0 ? paymentRef || null : null,
        direction: data.type === "stock_adjustment" ? direction : null,
        categoryId,
        sourceVoucherId: src?.voucher.id ?? ex?.sourceVoucherId ?? null,
        sourceVoucherIds: data.sourceRefs.length > 1 ? data.sourceRefs.map((r) => r.id) : undefined,
        originalInvoiceNo: originalInvoiceNo || null,
        originalInvoiceDate: originalInvoiceDate || null,
        supplierInvoiceNo: supplierInvoiceNo || null,
        poNumber: poNumber || null,
        ewayBillNo: ewayBillNo || null,
        vehicleNo: vehicleNo || null,
        transportName: transportName || null,
        notes: notes || null,
        terms: terms || null,
        lines: usedLines.map((l) => {
          const item = l.itemId ? itemMap.get(l.itemId) : undefined;
          const alt = l.unit === "alt" && item?.altFactorMilli;
          return {
            itemId: l.itemId,
            description: l.description.trim() || item?.name || "",
            hsn: l.hsn || null,
            qtyMilli: toMilli(l.qty),
            unitCode: alt ? item!.altUnitCode : (item?.unitCode ?? null),
            unitFactorMilli: alt ? item!.altFactorMilli! : 1000,
            ratePaise: toPaise(l.rate) || 0,
            rateIncludesTax: l.rateIncl,
            discountBp: toBasisPoints(l.discPct) || 0,
            taxRateId: l.taxRateId,
            gstBp: l.gstBp,
            cessBp: l.cessBp,
            mrpPaise: l.mrp ? toPaise(l.mrp) : null,
            batchNo: l.batchNo || null,
            expiryDate: l.expiryDate || null,
          };
        }),
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (after === "new") {
        router.push(`${info.path}/new?saved=${encodeURIComponent(res.number)}`);
        router.refresh();
      } else {
        const q = new URLSearchParams();
        if (res.warnings.length) q.set("warn", res.warnings.join("\n"));
        if (after === "print") q.set("print", "1");
        router.push(`${info.path}/${res.id}${q.size ? `?${q}` : ""}`);
        router.refresh();
      }
    },
    [info, lines, ex, data.type, number, date, dueDate, partyId, partyName, partyPhone, billingAddress, shippingAddress, placeOfSupply, reverseCharge, itcEligible, tcsBp, tdsBp, withoutTax, billDiscPct, billDiscAmt, roundOff, paidPaise, accountId, paymentMode, paymentRef, direction, categoryId, src, originalInvoiceNo, originalInvoiceDate, supplierInvoiceNo, poNumber, ewayBillNo, vehicleNo, transportName, notes, terms, itemMap, router],
  );

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current("view");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const partyOptions = useMemo(
    () =>
      parties
        .filter((p) => info.partySide === "any" || info.partySide === "none" || p.kind === "both" || p.kind === info.partySide || data.type === "expense" || data.type === "other_income" || p.id === partyId)
        .map((p) => ({
          value: p.id,
          label: p.name,
          keywords: `${p.phone ?? ""} ${p.gstin ?? ""}`,
          render: (
            <div className="flex items-baseline justify-between gap-3">
              <span>
                {p.name} <span className="text-xs text-faint">{p.phone}</span>
              </span>
              {data.see.balance && p.balancePaise !== 0 && <PartyBalance paise={p.balancePaise} className="text-xs" />}
            </div>
          ),
        })),
    [parties, info.partySide, data.type, partyId, data.see.balance],
  );

  const itemOptions = useMemo(
    () =>
      data.items.map((i) => ({
        value: i.id,
        label: i.name,
        keywords: `${i.code ?? ""} ${i.hsn ?? ""}`,
        render: (
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate">
              {i.name} {i.code && <span className="text-xs text-faint">{i.code}</span>}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {formatINR(info.priceSide === "sale" ? i.salePricePaise : i.purchasePricePaise)}
              {i.kind === "goods" && (
                <span className={cx("ml-2", i.stockMilli <= 0 ? "text-bad" : "text-good")}>
                  {formatQty(i.stockMilli)} {i.unitCode ?? ""}
                </span>
              )}
            </span>
          </div>
        ),
      })),
    [data.items, info.priceSide],
  );

  const showPartyBlock = info.partySide !== "none";
  const partyRequired = !info.takesPayment || data.type === "delivery_challan";
  const title = ex ? `Edit ${info.label.toLowerCase()} ${data.settings.prefix}${ex.number}` : src ? data.sourceRefs.length > 1 ? `New ${info.label.toLowerCase()} combining ${data.sourceRefs.map((r) => r.label).join(", ")}` : `New ${info.label.toLowerCase()} from ${VOUCHER_INFO[src.voucher.type].label.toLowerCase()} ${src.voucher.prefix}${src.voucher.number}` : `New ${info.label.toLowerCase()}`;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <span className="text-xs text-faint">Ctrl+S to save</span>
      </div>

      {error && <Alert tone="bad">{error}</Alert>}
      {warnings.map((w) => (
        <Alert key={w}>{w}</Alert>
      ))}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-3">
          {showPartyBlock && (
            <>
              <Field label={info.partySide === "supplier" ? "Supplier" : info.partySide === "customer" ? "Customer" : "Party"} htmlFor="party">
                <Combobox
                  id="party"
                  options={partyOptions}
                  value={partyId}
                  autoFocus={!ex}
                  placeholder={partyRequired ? "Search party by name or phone…" : "Search party, or leave empty for a cash bill"}
                  onChange={(v) => pickParty(v ? (parties.find((p) => p.id === v) ?? null) : null)}
                  footer={(q, close) => (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAddingParty(q);
                        close();
                      }}
                    >
                      + Add new party{q ? ` “${q}”` : ""}
                    </button>
                  )}
                />
              </Field>
              {party ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  {party.phone && <span>{party.phone}</span>}
                  {party.gstin && <span className="font-mono">{R.taxIdLabel} {party.gstin}</span>}
                  {R.usesStates && party.stateCode && <span>{stateName(party.stateCode)}</span>}
                  {data.see.balance && (
                    <span>
                      Balance: <PartyBalance paise={party.balancePaise} />
                    </span>
                  )}
                </div>
              ) : (
                info.takesPayment &&
                data.type !== "expense" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Customer name on bill (optional)">
                      <Input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Cash customer" />
                    </Field>
                    <Field label="Phone (optional)">
                      <Input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} type="tel" />
                    </Field>
                  </div>
                )
              )}
            </>
          )}

          {(data.type === "expense" || data.type === "other_income") && (
            <Field label="Category">
              <Select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Choose category…</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {data.type === "stock_adjustment" && (
            <Field label="Adjustment">
              <div className="flex gap-2">
                <Button variant={direction === 1 ? "primary" : "secondary"} onClick={() => setDirection(1)}>
                  Add stock
                </Button>
                <Button variant={direction === -1 ? "primary" : "secondary"} onClick={() => setDirection(-1)}>
                  Reduce stock
                </Button>
              </div>
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:w-80">
          <Field label="Number" hint={ex ? undefined : `Next: ${data.settings.prefix}${data.nextNumber}`}>
            <div className="flex items-center">
              {data.settings.prefix && <span className="flex h-9 items-center rounded-l-md border border-r-0 border-line bg-ground px-2 text-sm text-muted">{data.settings.prefix}</span>}
              <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} placeholder={String(data.nextNumber)} className={data.settings.prefix ? "rounded-l-none" : ""} inputMode="numeric" />
            </div>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max="2100-12-31" />
          </Field>
          {["sale_invoice", "purchase_bill", "quotation"].includes(data.type) && (
            <Field label={data.type === "quotation" ? "Valid until" : "Due date"}>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
          {data.type === "purchase_bill" && (
            <Field label="Supplier's bill no.">
              <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
            </Field>
          )}
          {["credit_note", "debit_note"].includes(data.type) && (
            <>
              <Field label="Against bill no.">
                <Input value={originalInvoiceNo} onChange={(e) => setOriginalInvoiceNo(e.target.value)} />
              </Field>
              <Field label="Bill date">
                <Input type="date" value={originalInvoiceDate} onChange={(e) => setOriginalInvoiceDate(e.target.value)} />
              </Field>
            </>
          )}
          {R.usesStates && info.hasLines && data.type !== "stock_adjustment" && data.type !== "expense" && (
            <Field label="Place of supply" className="col-span-2">
              <Select value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
                <option value="">
                  {pos ? `${stateName(pos)} (${supply === "intra" ? "CGST + SGST" : "IGST"})` : "Same as party's state"}
                </option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} – {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </div>

      {/* ── Lines ──────────────────────────────────────────────── */}
      {info.hasLines && (
        <div className="rounded-lg border border-line bg-panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line bg-ground/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="w-8 px-2 py-2">#</th>
                  <th className="min-w-64 px-2 py-2">{data.type === "expense" || data.type === "other_income" ? "Item / description" : "Item"}</th>
                  <th className="w-24 px-2 py-2 text-right">Qty</th>
                  <th className="w-28 px-2 py-2">Unit</th>
                  <th className="w-32 px-2 py-2 text-right">{data.type === "stock_adjustment" ? "Cost/unit" : "Rate"}</th>
                  {data.settings.lineDiscount && data.type !== "stock_adjustment" && <th className="w-20 px-2 py-2 text-right">Disc %</th>}
                  {!noTax && <th className="w-36 px-2 py-2">Tax</th>}
                  <th className="w-32 px-2 py-2 text-right">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const item = l.itemId ? itemMap.get(l.itemId) : undefined;
                  const r = calc.lines[idx];
                  const taxKnown = l.taxRateId ? taxMap.has(l.taxRateId) : true;
                  return (
                    <tr key={l.key} className="border-b border-line align-top last:border-0">
                      <td className="px-2 py-2 text-xs text-faint">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <Combobox
                          options={itemOptions}
                          value={l.itemId}
                          allowFreeText
                          freeText={l.itemId ? undefined : l.description}
                          onFreeText={(t) => pickItem(l.key, null, t)}
                          onChange={(v) => pickItem(l.key, v ? (itemMap.get(v) ?? null) : null)}
                          placeholder="Search item or type a description"
                        />
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
                          {R.usesHsn && (item?.hsn || l.hsn) && <span>HSN {l.hsn || item?.hsn}</span>}
                          {item?.kind === "goods" && (
                            <span className={item.stockMilli <= 0 ? "text-bad" : ""}>
                              In stock: {formatQty(item.stockMilli)} {item.unitCode}
                            </span>
                          )}
                          {data.settings.batchTracking && item?.kind === "goods" && (
                            <>
                              <input className="h-6 w-24 rounded border border-line px-1 text-xs" placeholder="Batch" value={l.batchNo} onChange={(e) => updateLine(l.key, { batchNo: e.target.value })} />
                              <input className="h-6 rounded border border-line px-1 text-xs" type="date" title="Expiry date" value={l.expiryDate} onChange={(e) => updateLine(l.key, { expiryDate: e.target.value })} />
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input id={`qty-${l.key}`} value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} inputMode="decimal" className={cx("num text-right", Number.isNaN(toMilli(l.qty)) && "border-bad")} />
                      </td>
                      <td className="px-2 py-1.5">
                        {item?.altUnitCode && item.altFactorMilli ? (
                          <Select
                            value={l.unit}
                            onChange={(e) => {
                              const unit = e.target.value as "base" | "alt";
                              const baseRate = info.priceSide === "sale" ? saleRateFor(item, priceParty, data.pricing).paise : item.purchasePricePaise;
                              const rate = unit === "alt" ? Math.round((baseRate * item.altFactorMilli!) / 1000) : baseRate;
                              updateLine(l.key, { unit, rate: rupees(rate) });
                            }}
                          >
                            <option value="base">{item.unitCode ?? "Unit"}</option>
                            <option value="alt">
                              {item.altUnitCode} (×{formatQty(item.altFactorMilli)})
                            </option>
                          </Select>
                        ) : (
                          <div className="flex h-9 items-center px-1 text-muted">{item?.unitCode ?? "—"}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} inputMode="decimal" className={cx("num text-right", Number.isNaN(toPaise(l.rate)) && "border-bad")} placeholder="0" />
                        {!noTax && (
                          <label className="mt-1 flex items-center justify-end gap-1 text-xs text-faint">
                            <input type="checkbox" checked={l.rateIncl} onChange={(e) => updateLine(l.key, { rateIncl: e.target.checked })} className="accent-brand-600" />
                            incl. tax
                          </label>
                        )}
                      </td>
                      {data.settings.lineDiscount && data.type !== "stock_adjustment" && (
                        <td className="px-2 py-1.5">
                          <Input value={l.discPct} onChange={(e) => updateLine(l.key, { discPct: e.target.value })} inputMode="decimal" className="num text-right" placeholder="0" />
                          {r?.lineDiscountPaise > 0 && <div className="mt-1 text-right text-xs text-faint">−{formatINR(r.lineDiscountPaise)}</div>}
                        </td>
                      )}
                      {!noTax && (
                        <td className="px-2 py-1.5">
                          <Select
                            value={l.taxRateId ?? (l.gstBp ? `bp:${l.gstBp}` : "")}
                            onChange={(e) => {
                              const id = Number(e.target.value);
                              const t = taxMap.get(id);
                              updateLine(l.key, { taxRateId: t ? id : null, gstBp: t?.gstBp ?? 0, cessBp: t?.cessBp ?? 0 });
                            }}
                          >
                            <option value="">No tax</option>
                            {!taxKnown || (!l.taxRateId && l.gstBp) ? <option value={l.taxRateId ?? `bp:${l.gstBp}`}>GST {l.gstBp / 100}%</option> : null}
                            {data.taxes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </Select>
                          {r && r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise > 0 && (
                            <div className="mt-1 text-xs text-faint">{formatINR(r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise)}</div>
                          )}
                        </td>
                      )}
                      <td className="num px-2 py-2.5 text-right font-medium">{r ? formatINR(r.totalPaise) : ""}</td>
                      <td className="px-1 py-1.5">
                        <button
                          type="button"
                          className="flex size-8 items-center justify-center rounded text-faint hover:bg-bad-bg hover:text-bad"
                          aria-label={`Remove line ${idx + 1}`}
                          onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine(data.settings.defaultPriceIncludesTax)] : ls.filter((x) => x.key !== l.key)))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, blankLine(data.settings.defaultPriceIncludesTax)])}>
              + Add line
            </Button>
            <span className="text-xs text-faint">
              {lines.filter((l) => l.itemId || l.description).length} line(s) · Qty{" "}
              {formatQty(lines.reduce((s, l) => s + (Number.isNaN(toMilli(l.qty)) ? 0 : toMilli(l.qty)), 0))}
            </span>
          </div>
        </div>
      )}

      {/* ── Footer: notes + totals ─────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
          {info.hasLines && info.outward && data.type !== "stock_adjustment" && (
            <button type="button" className="self-start text-sm text-brand-600 hover:underline" onClick={() => setShowMore((s) => !s)}>
              {showMore ? "Hide" : "Show"} shipping, transport & order details
            </button>
          )}
          {showMore && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Billing address">
                <Textarea rows={2} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
              </Field>
              <Field label="Shipping address">
                <Textarea rows={2} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} />
              </Field>
              <Field label="Customer PO number">
                <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </Field>
              <Field label="E-way bill no.">
                <Input value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} />
              </Field>
              <Field label="Vehicle no.">
                <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Transporter">
                <Input value={transportName} onChange={(e) => setTransportName(e.target.value)} />
              </Field>
              {data.type === "expense" && !withoutTax && <Checkbox label="Tax on this expense can be claimed back (input tax credit)" checked={itcEligible} onChange={(e) => setItcEligible(e.target.checked)} />}
              {data.type === "sale_invoice" && <Checkbox label="Tax payable on reverse charge" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />}
            </div>
          )}
          {info.hasLines && !composition && data.type !== "stock_adjustment" && data.type !== "delivery_challan" && (
            <Checkbox label={R.usesStates ? (info.outward ? "Bill of supply (no GST on this bill)" : "No GST on this bill") : `No ${R.taxName} on this bill (out of scope / exempt)`} checked={withoutTax} onChange={(e) => setWithoutTax(e.target.checked)} />
          )}
          <Field label="Notes (printed on the bill)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {info.outward && info.hasLines && data.type !== "stock_adjustment" && (
            <Field label="Terms & conditions">
              <Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 text-sm">
          <Line label="Items total" value={calc.grossPaise} />
          {calc.discountPaise > 0 && <Line label="Discount" value={-calc.discountPaise} />}
          {data.settings.billDiscount && info.hasLines && data.type !== "stock_adjustment" && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Bill discount</span>
              <div className="flex items-center gap-1">
                <Input value={billDiscPct} onChange={(e) => { setBillDiscPct(e.target.value); if (e.target.value) setBillDiscAmt(""); }} placeholder="%" className="num h-8 w-16 text-right" inputMode="decimal" />
                <span className="text-faint">or {region().currencyCode}</span>
                <Input value={billDiscAmt} onChange={(e) => { setBillDiscAmt(e.target.value); if (e.target.value) setBillDiscPct(""); }} placeholder="0" className="num h-8 w-24 text-right" inputMode="decimal" />
              </div>
            </div>
          )}
          {!noTax && (
            <>
              <Line label="Taxable value" value={calc.taxablePaise} muted />
              {calc.cgstPaise > 0 && <Line label={TL.cgst} value={calc.cgstPaise} muted />}
              {calc.sgstPaise > 0 && <Line label={TL.sgst} value={calc.sgstPaise} muted />}
              {calc.igstPaise > 0 && <Line label={TL.igst} value={calc.igstPaise} muted />}
              {calc.cessPaise > 0 && <Line label="Cess" value={calc.cessPaise} muted />}
            </>
          )}
          {data.type !== "stock_adjustment" && (
            <div className="flex items-center justify-between">
              <Checkbox label={<span className="text-muted">Round off</span>} checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} />
              <Money paise={calc.roundOffPaise} className="text-muted" />
            </div>
          )}
          {tcsAllowed && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted">
                TCS <Input value={tcsPct} onChange={(e) => setTcsPct(e.target.value)} inputMode="decimal" className="num h-7 w-16 text-right" placeholder="0" /> %
              </span>
              <Money paise={tcsPaise} className="text-muted" />
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-line pt-2 text-lg font-semibold">
            <span>Total</span>
            <Money paise={total} />
          </div>

          {tdsAllowed && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted">
                TDS {info.outward ? "deducted by customer" : "deducted from supplier"} <Input value={tdsPct} onChange={(e) => setTdsPct(e.target.value)} inputMode="decimal" className="num h-7 w-16 text-right" placeholder="0" /> %
              </span>
              <Money paise={-tdsPaise} className="text-muted" />
            </div>
          )}

          {info.takesPayment && (
            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
              {partyId ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">{info.outward ? "Received now" : "Paid now"}</span>
                    <Input value={fullyPaid ? rupees(payable) : paid} disabled={fullyPaid} onChange={(e) => setPaid(e.target.value)} placeholder="0" className="num h-8 w-32 text-right" inputMode="decimal" />
                  </div>
                  <Checkbox label={info.outward ? "Fully received" : "Fully paid"} checked={fullyPaid} onChange={(e) => setFullyPaid(e.target.checked)} />
                </>
              ) : (
                <p className="text-xs text-muted">No party chosen, so this is a cash bill: the full amount is recorded as {info.outward ? "received" : "paid"}.</p>
              )}
              {paidPaise > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <Select value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))} aria-label="Account">
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} aria-label="Payment mode">
                    {PAYMENT_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                  {paymentMode !== "Cash" && <Input className="col-span-2" placeholder="Reference / UTR / cheque no." value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />}
                </div>
              )}
              {partyId && (
                <div className="flex items-baseline justify-between font-medium">
                  <span>Balance due</span>
                  <Money paise={balance} className={balance > 0 ? "text-bad" : "text-good"} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Save bar ───────────────────────────────────────────── */}
      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur lg:left-56">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm text-muted">
            Total <strong className="num text-ink">{formatINR(total)}</strong>
          </span>
          <Button onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          {!ex && (
            <Button onClick={() => save("new")} disabled={saving}>
              Save & new
            </Button>
          )}
          <Button variant="primary" onClick={() => save("view")} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {addingParty !== null && (
        <QuickParty
          initialName={addingParty}
          kind={info.partySide === "supplier" ? "supplier" : "customer"}
          onClose={() => setAddingParty(null)}
          onSaved={(p) => {
            setParties((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name)));
            pickParty(p);
            setAddingParty(null);
          }}
        />
      )}
    </div>
  );
}

function Line({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between", muted && "text-muted")}>
      <span className={muted ? "" : "text-muted"}>{label}</span>
      <Money paise={value} />
    </div>
  );
}

export function QuickParty({
  initialName,
  kind,
  onClose,
  onSaved,
}: {
  initialName: string;
  kind: "customer" | "supplier";
  onClose: () => void;
  onSaved: (p: PartyOpt) => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await quickPartyAction({ name, phone, gstin, stateCode, billingAddress: address, kind });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onSaved(res.party);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add party">
      <div className="w-full max-w-lg rounded-xl bg-panel p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Add {kind}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Name" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
          </Field>
          <Field label={`${region().taxIdLabel} (optional)`}>
            <Input
              value={gstin}
              maxLength={15}
              className="font-mono uppercase"
              onChange={(e) => {
                const v = region().usesStates ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, "");
                setGstin(v);
                if (region().usesStates && /^\d{2}/.test(v) && GST_STATES.some((s) => s.code === v.slice(0, 2))) setStateCode(v.slice(0, 2));
              }}
            />
          </Field>
          {region().usesStates && (
          <Field label="State (optional)" className="sm:col-span-2">
            <Select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">Not set</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} – {s.name}
                </option>
              ))}
            </Select>
          </Field>
          )}
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Add party"}
          </Button>
        </div>
      </div>
    </div>
  );
}
