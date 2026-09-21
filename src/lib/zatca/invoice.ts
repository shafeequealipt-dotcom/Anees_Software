/**
 * ZATCA (Saudi e-invoicing, Phase 2) invoice XML in UBL 2.1.
 *
 * The XML is written already in canonical form (no whitespace between elements, attributes in sorted order, no self-closing
 * tags). That makes the hash of the invoice exact and repeatable: the bytes we hash are the bytes we send, minus the parts
 * ZATCA says to leave out (the signature block, the QR reference and the signature element).
 */
const NS = {
  main: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
};

export interface ZatcaAddress {
  street?: string | null;
  building?: string | null;
  district?: string | null;
  city?: string | null;
  postal?: string | null;
}

export interface ZatcaParty {
  name: string;
  /** VAT registration number. */
  vat?: string | null;
  /** Commercial registration number. */
  crn?: string | null;
  address: ZatcaAddress;
}

export type TaxCategory = "S" | "Z" | "E" | "O";

export interface ZatcaLine {
  name: string;
  quantity: number;
  /** UN/ECE Recommendation 20 unit code: PCE, KGM, LTR… */
  unitCode: string;
  /** Amount after discounts, before tax, in halalas. */
  netPaise: number;
  taxPaise: number;
  rateBp: number;
  category: TaxCategory;
}

export interface ZatcaInvoice {
  /** standard = business to business (cleared by ZATCA); simplified = to consumers (reported within 24 hours) */
  kind: "standard" | "simplified";
  docType: "invoice" | "credit" | "debit";
  id: string;
  uuid: string;
  issueDate: string;
  issueTime: string;
  supplier: ZatcaParty;
  buyer: ZatcaParty | null;
  lines: ZatcaLine[];
  /** Invoice counter value and the previous invoice's hash (the chain). */
  icv: number;
  pih: string;
  /** UN/CEFACT payment code: 10 cash, 30 credit, 42 bank account, 48 card. */
  paymentMeans: "10" | "30" | "42" | "48";
  /** Credit and debit notes point at the invoice they change and say why. */
  billingRef?: string;
  reason?: string;
  roundingPaise?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
const el = (tag: string, content: string, attrs: Record<string, string> = {}) => {
  const a = Object.keys(attrs)
    .sort()
    .map((k) => ` ${k}="${escAttr(attrs[k])}"`)
    .join("");
  return `<${tag}${a}>${content}</${tag}>`;
};
const money = (paise: number) => (paise / 100).toFixed(2);
const cur = { currencyID: "SAR" };
const amt = (tag: string, paise: number) => el(tag, money(paise), cur);
const cbc = (tag: string, v: string, attrs?: Record<string, string>) => el(`cbc:${tag}`, esc(v), attrs);

export const INVOICE_TYPE_CODE = { invoice: "388", credit: "381", debit: "383" } as const;
/** "NNPNESB": 01 standard or 02 simplified, then flags for third party, nominal, export, summary, self-billed (all off). */
const subtype = (k: ZatcaInvoice["kind"]) => `${k === "standard" ? "01" : "02"}00000`;

const EXEMPT: Record<Exclude<TaxCategory, "S">, { code: string; reason: string }> = {
  Z: { code: "VATEX-SA-32", reason: "Export of goods" },
  E: { code: "VATEX-SA-29", reason: "Financial services mentioned in Article 29 of the VAT Regulations" },
  O: { code: "VATEX-SA-OOS", reason: "Not subject to VAT" },
};

const taxCategory = (cat: TaxCategory, rateBp: number, tag = "cac:TaxCategory", withScheme = true) => {
  const idAttrs: Record<string, string> = withScheme ? { schemeAgencyID: "6", schemeID: "UN/ECE 5305" } : {};
  const schemeAttrs: Record<string, string> = withScheme ? { schemeAgencyID: "6", schemeID: "UN/ECE 5153" } : {};
  const ex = cat === "S" ? "" : cbc("TaxExemptionReasonCode", EXEMPT[cat].code) + cbc("TaxExemptionReason", EXEMPT[cat].reason);
  return el(tag, cbc("ID", cat, idAttrs) + cbc("Percent", (cat === "S" ? rateBp / 100 : 0).toFixed(2)) + ex + el("cac:TaxScheme", cbc("ID", "VAT", schemeAttrs)));
};

function party(p: ZatcaParty | null, wrapper: string): string {
  if (!p) return el(wrapper, el("cac:Party", ""));
  const a = p.address;
  const address = el(
    "cac:PostalAddress",
    (a.street ? cbc("StreetName", a.street) : "") +
      (a.building ? cbc("BuildingNumber", a.building) : "") +
      (a.district ? cbc("CitySubdivisionName", a.district) : "") +
      (a.city ? cbc("CityName", a.city) : "") +
      (a.postal ? cbc("PostalZone", a.postal) : "") +
      el("cac:Country", cbc("IdentificationCode", "SA")),
  );
  return el(
    wrapper,
    el(
      "cac:Party",
      (p.crn ? el("cac:PartyIdentification", cbc("ID", p.crn, { schemeID: "CRN" })) : "") +
        address +
        (p.vat ? el("cac:PartyTaxScheme", cbc("CompanyID", p.vat) + el("cac:TaxScheme", cbc("ID", "VAT"))) : "") +
        el("cac:PartyLegalEntity", cbc("RegistrationName", p.name)),
    ),
  );
}

export function totals(inv: ZatcaInvoice) {
  const net = inv.lines.reduce((s, l) => s + l.netPaise, 0);
  const tax = inv.lines.reduce((s, l) => s + l.taxPaise, 0);
  const rounding = inv.roundingPaise ?? 0;
  return { net, tax, inclusive: net + tax, payable: net + tax + rounding, rounding };
}

/** Everything except the parts that are left out of the hash. `withSigned` adds the QR reference and the signature element. */
function bodyParts(inv: ZatcaInvoice, qrBase64?: string) {
  const t = totals(inv);
  const head =
    cbc("ProfileID", "reporting:1.0") +
    cbc("ID", inv.id) +
    cbc("UUID", inv.uuid) +
    cbc("IssueDate", inv.issueDate) +
    cbc("IssueTime", inv.issueTime) +
    cbc("InvoiceTypeCode", INVOICE_TYPE_CODE[inv.docType], { name: subtype(inv.kind) }) +
    cbc("DocumentCurrencyCode", "SAR") +
    cbc("TaxCurrencyCode", "SAR") +
    (inv.billingRef ? el("cac:BillingReference", el("cac:InvoiceDocumentReference", cbc("ID", inv.billingRef))) : "");
  const refs =
    el("cac:AdditionalDocumentReference", cbc("ID", "ICV") + cbc("UUID", String(inv.icv))) +
    el("cac:AdditionalDocumentReference", cbc("ID", "PIH") + el("cac:Attachment", cbc("EmbeddedDocumentBinaryObject", inv.pih, { mimeCode: "text/plain" })));
  const qr = qrBase64 === undefined ? "" : el("cac:AdditionalDocumentReference", cbc("ID", "QR") + el("cac:Attachment", cbc("EmbeddedDocumentBinaryObject", qrBase64, { mimeCode: "text/plain" })));
  const sigEl = el("cac:Signature", cbc("ID", "urn:oasis:names:specification:ubl:signature:Invoice") + cbc("SignatureMethod", "urn:oasis:names:specification:ubl:dsig:enveloped:xades"));

  const parties = party(inv.supplier, "cac:AccountingSupplierParty") + party(inv.buyer, "cac:AccountingCustomerParty");
  const delivery = inv.kind === "standard" ? el("cac:Delivery", cbc("ActualDeliveryDate", inv.issueDate)) : "";
  const payment = el("cac:PaymentMeans", cbc("PaymentMeansCode", inv.paymentMeans) + (inv.reason ? cbc("InstructionNote", inv.reason) : ""));

  const groups = new Map<string, { cat: TaxCategory; rateBp: number; net: number; tax: number }>();
  for (const l of inv.lines) {
    const key = `${l.category}-${l.category === "S" ? l.rateBp : 0}`;
    const g = groups.get(key) ?? { cat: l.category, rateBp: l.rateBp, net: 0, tax: 0 };
    g.net += l.netPaise;
    g.tax += l.taxPaise;
    groups.set(key, g);
  }
  const taxTotals =
    el("cac:TaxTotal", amt("cbc:TaxAmount", t.tax)) +
    el(
      "cac:TaxTotal",
      amt("cbc:TaxAmount", t.tax) +
        [...groups.values()].map((g) => el("cac:TaxSubtotal", amt("cbc:TaxableAmount", g.net) + amt("cbc:TaxAmount", g.tax) + taxCategory(g.cat, g.rateBp))).join(""),
    );
  const legal = el(
    "cac:LegalMonetaryTotal",
    amt("cbc:LineExtensionAmount", t.net) +
      amt("cbc:TaxExclusiveAmount", t.net) +
      amt("cbc:TaxInclusiveAmount", t.inclusive) +
      amt("cbc:AllowanceTotalAmount", 0) +
      amt("cbc:PrepaidAmount", 0) +
      (t.rounding ? amt("cbc:PayableRoundingAmount", t.rounding) : "") +
      amt("cbc:PayableAmount", t.payable),
  );
  const lines = inv.lines
    .map((l, i) => {
      const unit = l.quantity > 0 ? l.netPaise / 100 / l.quantity : 0;
      return el(
        "cac:InvoiceLine",
        cbc("ID", String(i + 1)) +
          cbc("InvoicedQuantity", l.quantity.toFixed(6), { unitCode: l.unitCode }) +
          amt("cbc:LineExtensionAmount", l.netPaise) +
          el("cac:TaxTotal", amt("cbc:TaxAmount", l.taxPaise) + amt("cbc:RoundingAmount", l.netPaise + l.taxPaise)) +
          el("cac:Item", cbc("Name", l.name) + taxCategory(l.category, l.rateBp, "cac:ClassifiedTaxCategory", false)) +
          el("cac:Price", el("cbc:PriceAmount", unit.toFixed(4), cur)),
      );
    })
    .join("");
  return { head, refs, qr, sigEl, rest: parties + delivery + payment + taxTotals + legal + lines };
}

export const ROOT_OPEN = `<Invoice xmlns="${NS.main}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}">`;

/** The document exactly as it is hashed: no signature block, no QR reference, no signature element. */
export function canonicalForHash(inv: ZatcaInvoice): string {
  const b = bodyParts(inv);
  return `${ROOT_OPEN}${b.head}${b.refs}${b.rest}</Invoice>`;
}

/** The finished document: signature block first, then the invoice with its QR reference and signature element. */
export function assembleSigned(inv: ZatcaInvoice, ublExtensions: string, qrBase64: string): string {
  const b = bodyParts(inv, qrBase64);
  return `<?xml version="1.0" encoding="UTF-8"?>${ROOT_OPEN}${ublExtensions}${b.head}${b.refs}${b.qr}${b.sigEl}${b.rest}</Invoice>`;
}
