import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import type { DB } from "@/db";
import { accounts, firms, items, parties } from "@/db/schema";
import { amountInWords } from "@/lib/amount-in-words";
import { amountInWordsArabic } from "@/lib/arabic";
import { type InvoiceLanguage, labeller, resolveLanguage } from "@/lib/invoice-labels";
import { formatDate } from "@/lib/dates";
import { stateName } from "@/lib/gst/states";
import { formatMoney, formatPercent, formatQty } from "@/lib/money";
import { setRegion, taxColumnLabels } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { zatcaQrBase64 } from "@/lib/zatca";
import { listCustomFields } from "./custom-fields";
import { imageDataUrls } from "./company-images";
import { getVoucher } from "./vouchers";

export type PaperKind = "A4" | "A5" | "T80" | "T58";

/** Everything the printed invoice shows, already formatted as text so rendering can't pick up the wrong currency. */
export interface InvoiceModel {
  kind: "invoice" | "receipt";
  paper: PaperKind;
  layout: "classic" | "modern";
  accent: string;
  logo: string | null;
  signature: string | null;
  currency: string;
  title: string;
  fileName: string;
  cancelled: boolean;
  language: InvoiceLanguage;
  /** Fixed headings already in the chosen language. */
  ui: Record<string, string>;
  seller: { name: string; nameAr: string | null; lines: string[]; linesAr: string[]; taxIdLabel: string; taxId: string | null };
  meta: { k: string; v: string }[];
  party: { heading: string; name: string; nameAr: string | null; lines: string[]; linesAr: string[]; taxId: string | null; taxIdLabel: string };
  columns: { hsn: boolean; discount: boolean; tax: boolean };
  lines: { no: string; desc: string; descAr: string | null; hsn: string; qty: string; rate: string; discount: string; taxable: string; taxRate: string; tax: string; total: string }[];
  taxSummary: { rate: string; taxable: string; cgst: string; sgst: string; igst: string; total: string }[];
  taxLabels: { cgst: string; sgst: string; igst: string };
  split: boolean;
  totals: { k: string; v: string; bold?: boolean }[];
  words: string;
  wordsAr: string | null;
  bank: { k: string; v: string }[];
  qr: { src: string; caption: string } | null;
  terms: string | null;
  notes: string | null;
  receipt: { amount: string; mode: string; ref: string; settles: { no: string; date: string; amount: string }[] } | null;
}

const clean = (a: (string | null | undefined)[]) => a.filter((x): x is string => !!x && x.trim() !== "").map((x) => x.trim());

export async function loadInvoiceModel(db: DB, firmId: number, voucherId: number, opts: { paper?: PaperKind } = {}): Promise<InvoiceModel | null> {
  const data = await getVoucher(db, firmId, voucherId);
  if (!data) return null;
  const v = data.voucher;
  const info = VOUCHER_INFO[v.type];
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return null;
  const settings = await getSettings(db, firmId);
  const [party] = v.partyId ? await db.select().from(parties).where(and(eq(parties.id, v.partyId), eq(parties.firmId, firmId))) : [];
  const printFields = (await listCustomFields(db, firmId, { activeOnly: true })).filter((f) => f.showOnInvoice);
  const itemIds = [...new Set(data.lines.map((l) => l.itemId).filter((x): x is number => !!x))];
  const itemExtras = printFields.length && itemIds.length ? new Map((await db.select({ id: items.id, cv: items.customValues }).from(items).where(and(eq(items.firmId, firmId), inArray(items.id, itemIds)))).map((r) => [r.id, r.cv])) : new Map<number, Record<string, string>>();
  const itemAr = itemIds.length ? new Map((await db.select({ id: items.id, ar: items.nameAr }).from(items).where(and(eq(items.firmId, firmId), inArray(items.id, itemIds)))).map((r) => [r.id, r.ar])) : new Map<number, string | null>();
  const images = await imageDataUrls(db, firmId);
  const [account] = v.accountId ? await db.select().from(accounts).where(eq(accounts.id, v.accountId)) : [];

  const hasQr = firm.country === "SA" && !!firm.gstin && ["sale_invoice", "credit_note"].includes(v.type) && v.status === "active";
  const zatca = hasQr
    ? await QRCode.toDataURL(
        zatcaQrBase64({
          sellerName: firm.name,
          vatNumber: firm.gstin!,
          timestamp: v.createdAt.toISOString().replace(/\.\d+Z$/, "Z"),
          totalPaise: v.totalPaise,
          vatPaise: v.cgstPaise + v.sgstPaise + v.igstPaise + v.cessPaise,
        }),
        { margin: 1, width: 220 },
      )
    : null;
  const wantUpi = firm.country === "IN" && !!firm.upiId && settings.showUpiQrOnInvoice && v.type === "sale_invoice" && v.status === "active" && data.balancePaise > 0;
  const upi = wantUpi
    ? await QRCode.toDataURL(`upi://pay?pa=${encodeURIComponent(firm.upiId!)}&pn=${encodeURIComponent(firm.name)}&am=${(data.balancePaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(voucherNumber(v))}`, { margin: 1, width: 220 })
    : null;

  // ── From here on there is no `await`: the region is set once and every amount is formatted before anything else can run.
  const R = setRegion(firm.country);
  const TL = taxColumnLabels(R);
  const money = (p: number) => formatMoney(p, { symbol: false });
  const language = resolveLanguage(settings.invoiceLanguage, firm.country === "SA" ? "SA" : "IN");
  const L = labeller(language);
  const ar = language !== "en";
  const number = voucherNumber(v);
  const split = R.usesStates && v.igstPaise === 0;
  const hasTax = v.cgstPaise + v.sgstPaise + v.igstPaise + v.cessPaise > 0;
  const registered = !!firm.gstin;
  const titleEn =
    v.type === "sale_invoice"
      ? registered ? settings.documentTitles.sale_invoice || R.taxInvoiceTitle : "Invoice"
      : settings.documentTitles[v.type] || info.label;
  const title = L(titleEn);

  const seller = {
    name: firm.name,
    nameAr: ar ? firm.nameAr : null,
    linesAr: ar ? clean([firm.addressAr]) : [],
    lines: clean([firm.legalName && firm.legalName !== firm.name ? firm.legalName : null, firm.address, [firm.city, firm.pincode].filter(Boolean).join(" "), firm.phone ? `${L("Phone:")} ${firm.phone}` : null, firm.email, firm.website, R.usesStates && firm.stateCode ? `State: ${firm.stateCode} - ${stateName(firm.stateCode)}` : null]),
    taxIdLabel: R.country === "SA" ? L("VAT number (TRN)") : R.taxIdLabel,
    taxId: firm.gstin,
  };

  const meta: { k: string; v: string }[] = [];
  const add = (k: string, val: string | null | undefined) => {
    if (val) meta.push({ k, v: val });
  };
  add(v.type === "sale_invoice" ? L("Invoice no.") : ar ? `${L(titleEn)} #` : `${info.label} no.`, number);
  add(L("Date"), formatDate(v.date));
  if (v.dueDate) add(L(v.type === "quotation" ? "Valid until" : "Due date"), formatDate(v.dueDate));
  if (R.usesStates && v.placeOfSupply && info.partySide !== "none") add(L("Place of supply"), `${v.placeOfSupply} - ${stateName(v.placeOfSupply)}`);
  add(L("Supplier invoice no."), v.supplierInvoiceNo);
  add(L("PO no."), v.poNumber);
  add(L("Original invoice"), v.originalInvoiceNo);
  add(L("Vehicle no."), v.vehicleNo);
  add(L("Transport"), v.transportName);
  add("E-way bill", v.ewayBillNo);
  if (v.reverseCharge) add(L("Reverse charge"), "Yes");

  const partyModel = {
    heading: L(info.partySide === "supplier" ? "Supplier" : v.type === "delivery_challan" ? "Deliver to" : "Bill to"),
    name: v.partyName || (info.partySide === "none" ? "" : L("Cash")),
    nameAr: ar ? (party?.nameAr ?? null) : null,
    linesAr: ar ? clean([party?.addressAr]) : [],
    lines: clean([v.billingAddress ?? party?.billingAddress, v.partyPhone ? `${L("Phone:")} ${v.partyPhone}` : null, R.usesStates && party?.stateCode ? `State: ${party.stateCode} - ${stateName(party.stateCode)}` : null]),
    taxId: v.partyGstin,
    taxIdLabel: R.country === "SA" ? L("VAT number (TRN)") : R.taxIdLabel,
  };

  const lines = data.lines.map((l, i) => ({
    no: String(i + 1),
    descAr: ar && l.itemId ? (itemAr.get(l.itemId) ?? null) : null,
    desc: [l.description, ...printFields.map((f) => { const val = l.itemId ? itemExtras.get(l.itemId)?.[String(f.id)] : ""; return val ? `${f.name}: ${f.kind === "yesno" ? (val === "yes" ? "Yes" : "No") : val}` : ""; }).filter(Boolean)].join("\n"),
    hsn: l.hsn ?? "",
    qty: l.qtyMilli ? `${formatQty(l.qtyMilli)}${l.unitCode ? ` ${l.unitCode}` : ""}` : "",
    rate: money(l.ratePaise),
    discount: l.lineDiscountPaise + l.billDiscountPaise > 0 ? money(l.lineDiscountPaise + l.billDiscountPaise) : "",
    taxable: money(l.taxablePaise),
    taxRate: l.gstBp ? formatPercent(l.gstBp + l.cessBp) : "",
    tax: l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise ? money(l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise) : "",
    total: money(l.totalPaise),
  }));

  const groups = new Map<string, { bp: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }>();
  for (const l of data.lines) {
    if (!l.gstBp && !l.cessBp) continue;
    const key = `${l.gstBp}-${l.cessBp}`;
    const g = groups.get(key) ?? { bp: l.gstBp + l.cessBp, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    g.taxable += l.taxablePaise;
    g.cgst += l.cgstPaise;
    g.sgst += l.sgstPaise;
    g.igst += l.igstPaise + l.cessPaise;
    g.total += l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise;
    groups.set(key, g);
  }
  const taxSummary = [...groups.values()].sort((a, b) => a.bp - b.bp).map((g) => ({ rate: formatPercent(g.bp), taxable: money(g.taxable), cgst: money(g.cgst), sgst: money(g.sgst), igst: money(g.igst), total: money(g.total) }));

  const totals: InvoiceModel["totals"] = [];
  if (info.hasLines) {
    const discount = v.discountPaise + v.billDiscountPaise;
    if (discount > 0 || hasTax) totals.push({ k: L("Amount before tax"), v: money(v.taxablePaise) });
    if (discount > 0) totals.push({ k: L("Discount given"), v: money(discount) });
    if (v.cgstPaise) totals.push({ k: TL.cgst, v: money(v.cgstPaise) });
    if (v.sgstPaise) totals.push({ k: TL.sgst, v: money(v.sgstPaise) });
    if (v.igstPaise) totals.push({ k: R.country === "SA" ? L("VAT") : TL.igst, v: money(v.igstPaise) });
    if (v.cessPaise) totals.push({ k: TL.cess, v: money(v.cessPaise) });
    if (v.roundOffPaise) totals.push({ k: L("Round off"), v: money(v.roundOffPaise) });
    if (v.tcsPaise) totals.push({ k: `TCS (${formatPercent(v.tcsBp)})`, v: money(v.tcsPaise) });
  }
  totals.push({ k: L("Total"), v: money(v.totalPaise), bold: true });
  if (v.tdsPaise) totals.push({ k: `TDS deducted (${formatPercent(v.tdsBp)})`, v: `-${money(v.tdsPaise)}` });
  if (info.takesPayment && v.partyId) {
    if (v.paidPaise > 0) totals.push({ k: L("Paid"), v: money(v.paidPaise) });
    if (data.balancePaise > 0) totals.push({ k: L("Balance due"), v: money(data.balancePaise), bold: true });
  }

  const bank: { k: string; v: string }[] = [];
  if (settings.showBankDetailsOnInvoice && info.outward && info.hasLines) {
    if (firm.bankName) bank.push({ k: L("Bank"), v: firm.bankName });
    if (firm.bankAccountNo) bank.push({ k: R.country === "SA" ? L("IBAN / account") : "Account no.", v: firm.bankAccountNo });
    if (firm.bankIfsc) bank.push({ k: R.country === "SA" ? L("SWIFT / code") : "IFSC", v: firm.bankIfsc });
    if (firm.bankBranch) bank.push({ k: L("Branch"), v: firm.bankBranch });
    if (firm.upiId && R.country === "IN") bank.push({ k: "UPI", v: firm.upiId });
  }

  const receipt =
    info.hasLines
      ? null
      : {
          amount: money(v.totalPaise),
          mode: [v.paymentMode, account?.name].filter(Boolean).join(" · "),
          ref: v.paymentRef ?? "",
          settles: data.settles.map((s) => ({ no: `${s.prefix}${s.number}`, date: formatDate(s.date), amount: money(s.amountPaise) })),
        };

  return {
    kind: info.hasLines ? "invoice" : "receipt",
    paper: opts.paper ?? (settings.printPaperSize === "thermal" ? (settings.thermalWidthMm === 58 ? "T58" : "T80") : settings.printPaperSize === "A5" ? "A5" : "A4"),
    layout: settings.invoiceLayout,
    accent: /^#[0-9a-fA-F]{6}$/.test(settings.invoiceAccentColor) ? settings.invoiceAccentColor : "#1f4e79",
    logo: images.logo,
    signature: images.signature,
    currency: R.currencyCode,
    title: v.status === "cancelled" ? `${title} (CANCELLED)` : title,
    fileName: `${title.replace(/[^A-Za-z0-9]+/g, "-")}-${number.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`,
    cancelled: v.status === "cancelled",
    seller,
    meta,
    party: partyModel,
    columns: { hsn: R.usesHsn && data.lines.some((l) => !!l.hsn), discount: data.lines.some((l) => l.lineDiscountPaise + l.billDiscountPaise > 0), tax: hasTax },
    lines,
    taxSummary: hasTax ? taxSummary : [],
    taxLabels: { cgst: TL.cgst, sgst: TL.sgst, igst: TL.igst },
    split,
    totals,
    words: language === "ar" && R.country === "SA" ? amountInWordsArabic(v.totalPaise) : amountInWords(v.totalPaise),
    wordsAr: language === "bilingual" && R.country === "SA" ? amountInWordsArabic(v.totalPaise) : null,
    language,
    ui: Object.fromEntries(["Amounts in", "Item", "Qty", "Rate", "Discount", "Taxable", "Tax %", "Tax", "Amount", "HSN", "Amount in words", "Total tax", "Bank details", "Authorised signatory", "Terms and conditions", "Notes", "Page", "of", "Mode", "Reference", "Against bills", "Thank you!", "ZATCA QR code"].map((k) => [k, L(k)])),
    bank,
    qr: zatca ? { src: zatca, caption: L("ZATCA QR code") } : upi ? { src: upi, caption: "Scan to pay (UPI)" } : null,
    terms: v.terms || (info.outward && info.takesPayment ? firm.invoiceTerms : null),
    notes: v.notes,
    receipt,
  };
}

