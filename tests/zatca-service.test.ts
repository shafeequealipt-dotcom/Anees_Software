import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, taxRates, zatcaInvoices, zatcaSettings } from "@/db/schema";
import { seal, unseal } from "@/lib/secret-box";
import { saveParty, saveItem } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { cancelVoucher, saveVoucher } from "@/server/vouchers";
import { getProductionCertificate, getZatca, issueForVoucher, retryPending, runComplianceChecks, saveProfile, startOnboarding } from "@/server/zatca";
import { testDb } from "./helpers/db";

function haveOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const OK = haveOpenssl();

let db: DB;
let firmId: number;
const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let mode: "ok" | "reject" | "down" = "ok";

function certFor(privateKeyPem: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "zs-"));
  writeFileSync(path.join(dir, "k.pem"), privateKeyPem);
  execFileSync("openssl", ["req", "-new", "-x509", "-key", path.join(dir, "k.pem"), "-subj", "/DC=local/DC=gov/DC=extgazt/CN=TEST-CA", "-days", "30", "-sha256", "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
  return readFileSync(path.join(dir, "c.pem"), "utf8");
}
const token = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, "")).toString("base64");

async function fakeZatca(url: string, init: RequestInit) {
  const headers = init.headers as Record<string, string>;
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  calls.push({ url, headers, body });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
  if (url.endsWith("/compliance") || url.endsWith("/production/csids")) {
    const z = (await db.select().from(zatcaSettings).where(eq(zatcaSettings.firmId, firmId)))[0];
    const cert = certFor(unseal(z.privateKeyEnc ?? seal("")));
    return json(200, { binarySecurityToken: token(cert), secret: "the-secret", requestID: "1234567890" });
  }
  if (mode === "down") throw new Error("connection refused");
  if (mode === "reject") return json(400, { validationResults: { errorMessages: [{ code: "BR-KSA-17", message: "Invoice type is invalid" }], warningMessages: [] } });
  if (url.endsWith("/compliance/invoices")) return json(200, { validationResults: { status: "PASS", errorMessages: [], warningMessages: [{ code: "W1", message: "Just a warning" }] } });
  if (url.endsWith("/invoices/clearance/single")) {
    const xml = Buffer.from(String(body.invoice), "base64").toString("utf8").replace(/(<cbc:ID>QR<\/cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)[^<]*/, "$1STAMPEDQR");
    return json(200, { clearanceStatus: "CLEARED", clearedInvoice: Buffer.from(xml).toString("base64"), validationResults: { errorMessages: [], warningMessages: [] } });
  }
  return json(200, { reportingStatus: "REPORTED", validationResults: { errorMessages: [], warningMessages: [] } });
}

beforeAll(async () => {
  process.env.APP_SECRET = "test-secret-for-zatca-tests-0123456789";
  vi.stubGlobal("fetch", fakeZatca);
  db = await testDb();
  await runFirstSetup(db, { businessName: "Al Amal Trading Est.", country: "SA", gstin: "300000000000003", ownerName: "Owner", email: "o@a.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
});
afterAll(() => vi.unstubAllGlobals());

const profile = { environment: "sandbox" as const, crn: "1010010000", branchName: "Riyadh Main", businessCategory: "Supply activities", shortAddress: "RRRD2929", street: "Prince Sultan", building: "3242", district: "Al Olaya", city: "Riyadh", postal: "12211" };

describe.skipIf(!OK)("ZATCA onboarding and issuing (with a pretend ZATCA)", () => {
  it("checks the company details", async () => {
    await expect(saveProfile(db, firmId, { ...profile, crn: "123" }, 1)).rejects.toThrow(/10 digits/);
    await expect(saveProfile(db, firmId, { ...profile, shortAddress: "12" }, 1)).rejects.toThrow(/4 letters and 4 digits/);
    await saveProfile(db, firmId, profile, 1);
    expect((await getZatca(db, firmId))!.status).toBe("not_started");
  });

  it("swaps the one-time code for a certificate, keeping the key encrypted", async () => {
    await expect(startOnboarding(db, firmId, "12", 1)).rejects.toThrow(/6 digits/);
    await startOnboarding(db, firmId, "123456", 1);
    const z = (await getZatca(db, firmId))!;
    expect(z.status).toBe("compliance");
    expect(z.privateKeyEnc).toMatch(/^v1\./);
    expect(z.privateKeyEnc).not.toContain("BEGIN");
    expect(z.complianceCert).toMatch(/BEGIN CERTIFICATE/);
    expect(calls[0].url).toContain("/developer-portal/compliance");
    expect(calls[0].headers.OTP).toBe("123456");
    expect(Buffer.from(String(calls[0].body.csr), "base64").toString()).toContain("BEGIN CERTIFICATE REQUEST");
  });

  it("sends six samples, chained, with the compliance login", async () => {
    calls.length = 0;
    const results = await runComplianceChecks(db, firmId, 1);
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(6);
    expect(calls[0].headers.Authorization).toMatch(/^Basic /);
    expect(Buffer.from(calls[0].headers.Authorization.slice(6), "base64").toString().endsWith(":the-secret")).toBe(true);
    const xml = (i: number) => Buffer.from(String(calls[i].body.invoice), "base64").toString();
    expect(xml(1)).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${calls[0].body.invoiceHash}</cbc:EmbeddedDocumentBinaryObject>`);
    expect(new Set(calls.map((c) => c.body.invoiceHash)).size).toBe(6);
  });

  it("won't ask for the production certificate until every check has passed, then switches on", async () => {
    mode = "reject";
    await runComplianceChecks(db, firmId, 1);
    await expect(getProductionCertificate(db, firmId, 1)).rejects.toThrow(/All of them must pass/);
    mode = "ok";
    await runComplianceChecks(db, firmId, 1);
    await getProductionCertificate(db, firmId, 1);
    const z = (await getZatca(db, firmId))!;
    expect(z).toMatchObject({ status: "production", enabled: true });
  });

  async function sale(partyId: number | null, qty = 1) {
    const vat = (await db.select().from(taxRates).where(eq(taxRates.firmId, firmId))).find((r) => r.gstBp === 1500)!;
    const item = await saveItem(db, firmId, { name: `Dates ${Math.random()}`, salePricePaise: 10_000, taxRateId: vat.id, openingQtyMilli: 1_000_000 }, 1);
    return saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-21", partyId: partyId ?? undefined, partyName: partyId ? undefined : "Walk-in", paidPaise: 11_500 * qty, roundOff: false, lines: [{ itemId: item, description: "Dates 1kg", qtyMilli: qty * 1000, ratePaise: 10_000, taxRateId: vat.id }] }, 1);
  }

  it("issues a consumer invoice: signed, numbered 1, and reported", async () => {
    calls.length = 0;
    const b = await sale(null);
    const rec = (await issueForVoucher(db, firmId, b.id))!;
    expect(rec).toMatchObject({ icv: 1, kind: "simplified", status: "reported" });
    expect(calls[0].url).toContain("/invoices/reporting/single");
    expect(calls[0].headers["Clearance-Status"]).toBe("0");
    expect(rec.xml).toContain("<cbc:UUID>1</cbc:UUID>");
    expect(rec.xml).toContain("<ds:SignatureValue>");
    expect(rec.qr.length).toBeGreaterThan(100);
    expect((await issueForVoucher(db, firmId, b.id))!.id).toBe(rec.id); // not issued twice
  });

  it("chains the next invoice to the previous hash, and business invoices are cleared", async () => {
    calls.length = 0;
    const first = (await db.select().from(zatcaInvoices))[0];
    const buyer = await saveParty(db, firmId, { name: "Riyadh Stores", nameAr: "متاجر الرياض", gstin: "310000000000003", kind: "customer", saStreet: "Olaya", saBuilding: "1234", saDistrict: "Al Olaya", saCity: "Riyadh", saPostal: "12211" }, 1);
    const b = await sale(buyer);
    const rec = (await issueForVoucher(db, firmId, b.id))!;
    expect(rec).toMatchObject({ icv: 2, kind: "standard", status: "cleared" });
    expect(rec.xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${first.invoiceHash}</cbc:EmbeddedDocumentBinaryObject>`);
    expect(calls[0].url).toContain("/invoices/clearance/single");
    expect(calls[0].headers["Clearance-Status"]).toBe("1");
    expect(rec.qr).toBe("STAMPEDQR"); // ZATCA's stamped copy replaces ours
    expect(rec.clearedXml).toContain("STAMPEDQR");
    expect(rec.xml).toContain('name="0100000"');
    expect(rec.xml).toContain("متاجر الرياض");
  });

  it("locks an issued invoice against edits and cancelling", async () => {
    const rec = (await db.select().from(zatcaInvoices))[0];
    await expect(cancelVoucher(db, firmId, rec.voucherId, 1)).rejects.toThrow(/credit note/);
    await expect(saveVoucher(db, firmId, { id: rec.voucherId, type: "sale_invoice", date: "2026-09-21", partyName: "x", lines: [{ description: "x", qtyMilli: 1000, ratePaise: 100 }] }, 1)).rejects.toThrow(/credit note/);
  });

  it("keeps a rejected invoice with ZATCA's reason, and retries one it couldn't send", async () => {
    mode = "reject";
    const bad = await sale(null);
    const rej = (await issueForVoucher(db, firmId, bad.id))!;
    expect(rej.status).toBe("rejected");
    expect(rej.error).toContain("BR-KSA-17");
    mode = "down";
    const later = await sale(null);
    const pend = (await issueForVoucher(db, firmId, later.id))!;
    expect(pend.status).toBe("pending");
    expect(pend.attempts).toBe(1);
    mode = "ok";
    expect(await retryPending(db, firmId)).toBe(1);
    expect((await db.select().from(zatcaInvoices).where(eq(zatcaInvoices.id, pend.id)))[0].status).toBe("reported");
  });

  it("does nothing for a company that hasn't switched e-invoicing on", async () => {
    const db2 = await testDb();
    await runFirstSetup(db2, { businessName: "Small Co", country: "SA", ownerName: "O", email: "o@s.example", password: "Tulsi-Garden-4471" });
    const [f2] = await db2.select().from(firms);
    const v = await saveVoucher(db2, f2.id, { type: "expense", date: "2026-09-21", lines: [{ description: "x", qtyMilli: 1000, ratePaise: 100 }] }, 1);
    expect(await issueForVoucher(db2, f2.id, v.id)).toBeNull();
  });
});
