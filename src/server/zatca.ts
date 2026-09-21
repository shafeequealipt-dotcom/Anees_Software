import "server-only";
import { randomUUID, X509Certificate } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { firms, parties, taxRates, zatcaInvoices, zatcaSettings, type vouchers, type voucherLines } from "@/db/schema";
import { audit } from "@/lib/audit";
import { seal, unseal } from "@/lib/secret-box";
import { buildCsr, generateEgsKeys, type ZatcaEnvironment } from "@/lib/zatca/csr";
import { certificateFromToken, checkComplianceInvoice, clearInvoice, reportInvoice, requestComplianceCsid, requestProductionCsid, type ZatcaAuth, type ZatcaResult } from "@/lib/zatca/client";
import type { TaxCategory, ZatcaInvoice, ZatcaLine } from "@/lib/zatca/invoice";
import { FIRST_PIH, signInvoice } from "@/lib/zatca/sign";
import { getVoucher } from "./vouchers";
import { MasterError } from "./masters";

type Settings = typeof zatcaSettings.$inferSelect;

export const profileSchema = z.object({
  environment: z.enum(["sandbox", "simulation", "production"]),
  crn: z.string().trim().regex(/^\d{10}$/, "The commercial registration number is 10 digits."),
  branchName: z.string().trim().min(1, "Enter a branch name.").max(100),
  businessCategory: z.string().trim().min(1, "Enter the business activity, e.g. Supply activities.").max(100),
  shortAddress: z.string().trim().toUpperCase().regex(/^[A-Z]{4}\d{4}$/, "The short address is 4 letters and 4 digits, e.g. RRRD2929."),
  street: z.string().trim().min(1, "Enter the street.").max(120),
  building: z.string().trim().regex(/^\d{4}$/, "The building number is 4 digits."),
  district: z.string().trim().min(1, "Enter the district.").max(80),
  city: z.string().trim().min(1, "Enter the city.").max(80),
  postal: z.string().trim().regex(/^\d{5}$/, "The postal code is 5 digits."),
});

export async function getZatca(db: DB, firmId: number): Promise<Settings | null> {
  const [z] = await db.select().from(zatcaSettings).where(eq(zatcaSettings.firmId, firmId));
  return z ?? null;
}

export async function saveProfile(db: DB, firmId: number, raw: z.input<typeof profileSchema>, userId: number) {
  const p = profileSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, String(p.error.issues[0].path[0]));
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (firm?.country !== "SA") throw new MasterError("E-invoicing is for companies in Saudi Arabia.");
  const cur = await getZatca(db, firmId);
  if (cur && cur.status !== "not_started" && cur.environment !== p.data.environment) throw new MasterError("The environment can't change once onboarding has started. Start again from the beginning if you must.");
  await db.insert(zatcaSettings).values({ firmId, ...p.data }).onConflictDoUpdate({ target: zatcaSettings.firmId, set: { ...p.data, updatedAt: new Date() } });
  await audit(db, { firmId, userId, action: "settings", entity: "zatca", summary: "Changed e-invoicing details" });
}

const tokenOf = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, "")).toString("base64");

function authOf(z: Settings, stage: "compliance" | "production"): ZatcaAuth {
  const cert = stage === "compliance" ? z.complianceCert : z.productionCert;
  const secret = stage === "compliance" ? z.complianceSecretEnc : z.productionSecretEnc;
  if (!cert || !secret) throw new MasterError(`The ${stage} certificate is missing.`);
  return { token: tokenOf(cert), secret: unseal(secret) };
}

function complete(z: Settings | null): asserts z is Settings & { crn: string; branchName: string; businessCategory: string; shortAddress: string; street: string; building: string; district: string; city: string; postal: string } {
  if (!z || !z.crn || !z.branchName || !z.shortAddress || !z.street || !z.building || !z.district || !z.city || !z.postal || !z.businessCategory) throw new MasterError("Fill in and save the company details first.");
}

const summarize = (r: ZatcaResult) => r.messages.filter((m) => m.level !== "info").map((m) => `${m.level === "error" ? "Error" : "Warning"} ${m.text}`).join(" | ");

/** Step 1: create the device key and certificate request, and trade the one-time code for a compliance certificate. */
export async function startOnboarding(db: DB, firmId: number, otp: string, userId: number) {
  const z = await getZatca(db, firmId);
  complete(z);
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm?.gstin) throw new MasterError("Add your VAT number in Settings → This company first.");
  if (!/^\d{6}$/.test(otp.trim())) throw new MasterError("The one-time code from the Fatoora portal is 6 digits.", "otp");
  const egsSerial = z.egsSerial ?? `1-BillingApp|2-1.0|3-${randomUUID()}`;
  const keys = z.privateKeyEnc ? null : generateEgsKeys();
  const privateKeyPem = keys ? keys.privateKeyPem : unseal(z.privateKeyEnc!);
  const csr = buildCsr({
    privateKeyPem,
    organizationName: firm.name,
    organizationUnit: z.branchName,
    commonName: `BILLING-${firm.gstin}`,
    vatNumber: firm.gstin,
    serialNumber: egsSerial,
    invoiceType: "1100",
    address: z.shortAddress,
    businessCategory: z.businessCategory,
    environment: z.environment as ZatcaEnvironment,
  });
  // Keep the key and request before calling ZATCA, so a failed attempt can be retried with the same key.
  await db.update(zatcaSettings).set({ egsSerial, csr, privateKeyEnc: z.privateKeyEnc ?? seal(privateKeyPem), updatedAt: new Date() }).where(eq(zatcaSettings.firmId, firmId));
  const r = await requestComplianceCsid(z.environment as ZatcaEnvironment, csr, otp.trim());
  if (!r.ok) throw new MasterError(`ZATCA refused the request${r.status ? ` (${r.status})` : ""}: ${summarize(r) || "no details given"}. Get a fresh one-time code and try again.`, "otp");
  const token = String(r.body.binarySecurityToken ?? "");
  const secret = String(r.body.secret ?? "");
  if (!token || !secret) throw new MasterError("ZATCA's answer was missing the certificate. Try again.");
  await db
    .update(zatcaSettings)
    .set({
      complianceCert: certificateFromToken(token),
      complianceSecretEnc: seal(secret),
      complianceRequestId: String(r.body.requestID ?? ""),
      status: "compliance",
      updatedAt: new Date(),
    })
    .where(eq(zatcaSettings.firmId, firmId));
  await audit(db, { firmId, userId, action: "settings", entity: "zatca", summary: "Received the e-invoicing compliance certificate" });
}

const SAMPLE_BUYER = { name: "Sample Buyer Co", vat: "399999999800003", address: { street: "Sample Street", building: "1234", district: "Al Olaya", city: "Riyadh", postal: "12211" } };

/** Step 2: send one sample of each invoice type for ZATCA to check. All of them must pass before a production certificate is issued. */
export async function runComplianceChecks(db: DB, firmId: number, userId: number) {
  const z = await getZatca(db, firmId);
  complete(z);
  if (!z.complianceCert || !z.privateKeyEnc) throw new MasterError("Get the compliance certificate first.");
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  const privateKeyPem = unseal(z.privateKeyEnc);
  const auth = authOf(z, "compliance");
  const supplier = { name: firm.name, vat: firm.gstin, crn: z.crn, address: { street: z.street, building: z.building, district: z.district, city: z.city, postal: z.postal } };
  const cases: { label: string; kind: "standard" | "simplified"; docType: "invoice" | "credit" | "debit" }[] = [];
  for (const kind of ["standard", "simplified"] as const) for (const docType of ["invoice", "credit", "debit"] as const) cases.push({ label: `${kind === "standard" ? "Standard" : "Simplified"} ${docType === "invoice" ? "invoice" : docType === "credit" ? "credit note" : "debit note"}`, kind, docType });

  let pih = FIRST_PIH;
  const results: { label: string; ok: boolean; status: number; messages: string[] }[] = [];
  const now = new Date();
  for (let n = 0; n < cases.length; n++) {
    const c = cases[n];
    const inv: ZatcaInvoice = {
      kind: c.kind,
      docType: c.docType,
      id: `SAMPLE-${n + 1}`,
      uuid: randomUUID(),
      issueDate: now.toISOString().slice(0, 10),
      issueTime: now.toISOString().slice(11, 19),
      supplier: supplier as ZatcaInvoice["supplier"],
      buyer: c.kind === "standard" ? SAMPLE_BUYER : null,
      lines: [{ name: "Sample item", quantity: 2, unitCode: "PCE", netPaise: 20_000, taxPaise: 3_000, rateBp: 1500, category: "S" }],
      icv: n + 1,
      pih,
      paymentMeans: "10",
      ...(c.docType === "invoice" ? {} : { billingRef: "SAMPLE-1", reason: "Sample correction" }),
    };
    const s = signInvoice({ invoice: inv, privateKeyPem, certificate: z.complianceCert, signingTime: now.toISOString().replace(/\.\d+Z$/, "Z"), sellerName: firm.name, includeStamp: c.kind === "simplified" });
    pih = s.hash;
    const r = await checkComplianceInvoice(z.environment as ZatcaEnvironment, auth, { invoiceHash: s.hash, uuid: inv.uuid, xml: s.xml });
    const passed = r.ok && !r.messages.some((m) => m.level === "error");
    results.push({ label: c.label, ok: passed, status: r.status, messages: r.messages.map((m) => `${m.level}: ${m.text}`) });
    if (r.networkError) break;
  }
  await db.update(zatcaSettings).set({ lastCheck: { at: now.toISOString(), results }, updatedAt: new Date() }).where(eq(zatcaSettings.firmId, firmId));
  await audit(db, { firmId, userId, action: "settings", entity: "zatca", summary: `E-invoicing checks: ${results.filter((r) => r.ok).length} of ${results.length} passed` });
  return results;
}

/** Step 3: once every sample has passed, ask for the production certificate and switch e-invoicing on. */
export async function getProductionCertificate(db: DB, firmId: number, userId: number) {
  const z = await getZatca(db, firmId);
  complete(z);
  const check = z.lastCheck as { results?: { ok: boolean }[] } | null;
  if (!check?.results?.length || !check.results.every((r) => r.ok)) throw new MasterError("Run the checks first. All of them must pass.");
  if (!z.complianceRequestId) throw new MasterError("The compliance request number is missing. Start the certificate step again.");
  const r = await requestProductionCsid(z.environment as ZatcaEnvironment, authOf(z, "compliance"), z.complianceRequestId);
  if (!r.ok) throw new MasterError(`ZATCA refused the production certificate${r.status ? ` (${r.status})` : ""}: ${summarize(r) || "no details given"}`);
  const token = String(r.body.binarySecurityToken ?? "");
  const secret = String(r.body.secret ?? "");
  if (!token || !secret) throw new MasterError("ZATCA's answer was missing the certificate. Try again.");
  await db.update(zatcaSettings).set({ productionCert: certificateFromToken(token), productionSecretEnc: seal(secret), status: "production", enabled: true, updatedAt: new Date() }).where(eq(zatcaSettings.firmId, firmId));
  await audit(db, { firmId, userId, action: "settings", entity: "zatca", summary: "E-invoicing switched on (production certificate received)" });
}

export async function setEnabled(db: DB, firmId: number, enabled: boolean, userId: number) {
  const z = await getZatca(db, firmId);
  if (!z || z.status !== "production") throw new MasterError("Finish the onboarding steps first.");
  await db.update(zatcaSettings).set({ enabled, updatedAt: new Date() }).where(eq(zatcaSettings.firmId, firmId));
  await audit(db, { firmId, userId, action: "settings", entity: "zatca", summary: `E-invoicing ${enabled ? "switched on" : "paused"}` });
}

// ─── Turning a bill into an e-invoice ────────────────────────────────────────

const UNIT: Record<string, string> = { PCS: "PCE", NOS: "PCE", UNT: "PCE", KGS: "KGM", GMS: "GRM", LTR: "LTR", MLT: "MLT", MTR: "MTR", BOX: "BX", PAC: "PA", DOZ: "DZN", SET: "SET", BAG: "BG", BTL: "BO", CTN: "CT", TON: "TNE", SQM: "MTK", SQF: "FTK" };

export interface VoucherForZatca {
  voucher: typeof vouchers.$inferSelect;
  lines: (typeof voucherLines.$inferSelect)[];
  originalNumber: string | null;
}

/** Pure mapping from a saved bill to the e-invoice, so it can be tested on its own. */
export function buildZatcaInvoice(
  v: VoucherForZatca,
  ctx: { firm: { name: string; gstin: string }; settings: { crn: string; street: string; building: string; district: string; city: string; postal: string }; party: typeof parties.$inferSelect | null; natures: Map<number, string>; icv: number; pih: string; uuid: string },
): ZatcaInvoice {
  const { voucher: b } = v;
  const buyerVat = ctx.party?.gstin ?? b.partyGstin ?? null;
  const kind = buyerVat ? "standard" : "simplified";
  const lines: ZatcaLine[] = v.lines.map((l) => {
    const nature = l.taxRateId ? ctx.natures.get(l.taxRateId) : undefined;
    const category: TaxCategory = l.gstBp > 0 ? "S" : nature === "exempt" ? "E" : nature === "non_gst" ? "O" : nature === "nil" ? "Z" : "S";
    return { name: l.description, quantity: l.qtyMilli / 1000, unitCode: UNIT[(l.unitCode ?? "").toUpperCase()] ?? "PCE", netPaise: l.taxablePaise, taxPaise: l.cgstPaise + l.sgstPaise + l.igstPaise, rateBp: l.gstBp, category };
  });
  const mode = (b.paymentMode ?? "").toLowerCase();
  const balance = b.totalPaise - b.paidPaise;
  return {
    kind,
    docType: b.type === "credit_note" ? "credit" : "invoice",
    id: `${b.prefix}${b.number}`,
    uuid: ctx.uuid,
    issueDate: b.date,
    issueTime: b.createdAt.toISOString().slice(11, 19),
    supplier: { name: ctx.firm.name, vat: ctx.firm.gstin, crn: ctx.settings.crn, address: { street: ctx.settings.street, building: ctx.settings.building, district: ctx.settings.district, city: ctx.settings.city, postal: ctx.settings.postal } },
    buyer:
      kind === "standard"
        ? { name: ctx.party?.nameAr || ctx.party?.name || b.partyName || "Customer", vat: buyerVat, address: { street: ctx.party?.saStreet, building: ctx.party?.saBuilding, district: ctx.party?.saDistrict, city: ctx.party?.saCity, postal: ctx.party?.saPostal } }
        : null,
    lines,
    icv: ctx.icv,
    pih: ctx.pih,
    paymentMeans: balance > 0 ? "30" : /card|mada|visa|master/.test(mode) ? "48" : /bank|transfer|cheque|check/.test(mode) ? "42" : "10",
    ...(b.type === "credit_note" ? { billingRef: v.originalNumber ?? b.originalInvoiceNo ?? "", reason: b.notes || "Return of goods" } : {}),
    roundingPaise: b.roundOffPaise || undefined,
  };
}

const stampedQr = (xml: string) => xml.match(/<cbc:ID>QR<\/cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]*)</)?.[1] ?? null;

/** Signs and chains the bill for ZATCA, then sends it. The bill can't be edited afterwards. Never throws for network trouble: the send is retried. */
export async function issueForVoucher(db: DB, firmId: number, voucherId: number) {
  const z = await getZatca(db, firmId);
  if (!z || !z.enabled || z.status !== "production" || !z.productionCert || !z.privateKeyEnc) return null;
  const [existing] = await db.select().from(zatcaInvoices).where(eq(zatcaInvoices.voucherId, voucherId));
  if (existing) return existing;
  const data = await getVoucher(db, firmId, voucherId);
  if (!data || !["sale_invoice", "credit_note"].includes(data.voucher.type) || data.voucher.status !== "active") return null;
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm?.gstin) return null;
  complete(z);
  const [party] = data.voucher.partyId ? await db.select().from(parties).where(and(eq(parties.id, data.voucher.partyId), eq(parties.firmId, firmId))) : [];
  const natures = new Map((await db.select({ id: taxRates.id, nature: taxRates.nature }).from(taxRates).where(eq(taxRates.firmId, firmId))).map((t) => [t.id, t.nature]));
  const privateKeyPem = unseal(z.privateKeyEnc);

  const rec = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(zatcaSettings).where(eq(zatcaSettings.firmId, firmId)).for("update");
    const icv = cur.icv + 1;
    const pih = cur.lastHash ?? FIRST_PIH;
    const uuid = randomUUID();
    const inv = buildZatcaInvoice({ voucher: data.voucher, lines: data.lines, originalNumber: data.sources[0] ? `${data.sources[0].prefix}${data.sources[0].number}` : null }, { firm: { name: firm.name, gstin: firm.gstin! }, settings: z, party: party ?? null, natures, icv, pih, uuid });
    const s = signInvoice({ invoice: inv, privateKeyPem, certificate: z.productionCert!, signingTime: new Date().toISOString().replace(/\.\d+Z$/, "Z"), sellerName: firm.name, includeStamp: inv.kind === "simplified" });
    const [row] = await tx.insert(zatcaInvoices).values({ firmId, voucherId, uuid, icv, kind: inv.kind, invoiceHash: s.hash, qr: s.qr, xml: s.xml }).returning();
    await tx.update(zatcaSettings).set({ icv, lastHash: s.hash, updatedAt: new Date() }).where(eq(zatcaSettings.firmId, firmId));
    return row;
  });
  await submitInvoice(db, firmId, rec.id);
  const [fresh] = await db.select().from(zatcaInvoices).where(eq(zatcaInvoices.id, rec.id));
  return fresh;
}

/** Sends one signed invoice: reporting for consumer invoices, clearance for business-to-business. */
export async function submitInvoice(db: DB, firmId: number, recordId: number) {
  const z = await getZatca(db, firmId);
  const [rec] = await db.select().from(zatcaInvoices).where(and(eq(zatcaInvoices.id, recordId), eq(zatcaInvoices.firmId, firmId)));
  if (!z || !rec || rec.status === "reported" || rec.status === "cleared") return rec ?? null;
  const send = rec.kind === "standard" ? clearInvoice : reportInvoice;
  const r = await send(z.environment as ZatcaEnvironment, authOf(z, "production"), { invoiceHash: rec.invoiceHash, uuid: rec.uuid, xml: rec.xml });
  const errors = r.messages.filter((m) => m.level === "error");
  const accepted = r.ok && errors.length === 0;
  const cleared = typeof r.body.clearedInvoice === "string" ? Buffer.from(r.body.clearedInvoice, "base64").toString("utf8") : null;
  await db
    .update(zatcaInvoices)
    .set({
      status: accepted ? (rec.kind === "standard" ? "cleared" : "reported") : r.networkError || r.status >= 500 ? "pending" : "rejected",
      response: { status: r.status, body: r.body },
      error: accepted ? (r.messages.filter((m) => m.level === "warning").map((m) => m.text).join(" | ") || null) : r.messages.map((m) => `${m.level}: ${m.text}`).join(" | ") || `HTTP ${r.status}`,
      attempts: rec.attempts + 1,
      submittedAt: new Date(),
      clearedXml: cleared,
      qr: (cleared && stampedQr(cleared)) || rec.qr,
    })
    .where(eq(zatcaInvoices.id, recordId));
  return (await db.select().from(zatcaInvoices).where(eq(zatcaInvoices.id, recordId)))[0];
}

/** Tries again for invoices that couldn't be sent (ZATCA unreachable). Runs with the scheduled job. */
export async function retryPending(db: DB, firmId: number): Promise<number> {
  const pending = await db.select({ id: zatcaInvoices.id }).from(zatcaInvoices).where(and(eq(zatcaInvoices.firmId, firmId), eq(zatcaInvoices.status, "pending"), lt(zatcaInvoices.attempts, 20)));
  for (const p of pending) await submitInvoice(db, firmId, p.id);
  return pending.length;
}

export async function listZatcaInvoices(db: DB, firmId: number, limit = 100) {
  return db.select().from(zatcaInvoices).where(eq(zatcaInvoices.firmId, firmId)).orderBy(zatcaInvoices.id).limit(limit);
}

export async function zatcaForVoucher(db: DB, voucherId: number) {
  const [r] = await db.select().from(zatcaInvoices).where(eq(zatcaInvoices.voucherId, voucherId));
  return r ?? null;
}

export async function statusCounts(db: DB, firmId: number) {
  const rows = await db.select({ status: zatcaInvoices.status }).from(zatcaInvoices).where(and(eq(zatcaInvoices.firmId, firmId), inArray(zatcaInvoices.status, ["pending", "rejected"])));
  return { pending: rows.filter((r) => r.status === "pending").length, rejected: rows.filter((r) => r.status === "rejected").length };
}

export function certificateInfo(pem: string | null) {
  if (!pem) return null;
  const c = new X509Certificate(pem);
  return { validTo: c.validTo, subject: c.subject.replace(/\n/g, ", ") };
}
