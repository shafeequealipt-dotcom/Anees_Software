import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, createVerify } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateEgsKeys } from "@/lib/zatca/csr";
import type { ZatcaInvoice } from "@/lib/zatca/invoice";
import { canonicalForHash, totals } from "@/lib/zatca/invoice";
import { FIRST_PIH, invoiceHash, signInvoice } from "@/lib/zatca/sign";

function testCertificate(privateKeyPem: string): string | null {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "zc-"));
    writeFileSync(path.join(dir, "k.pem"), privateKeyPem);
    execFileSync("openssl", ["req", "-new", "-x509", "-key", path.join(dir, "k.pem"), "-subj", "/DC=local/DC=gov/DC=extgazt/CN=TEST-CA", "-days", "30", "-sha256", "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
    return readFileSync(path.join(dir, "c.pem"), "utf8");
  } catch {
    return null;
  }
}

const invoice: ZatcaInvoice = {
  kind: "simplified",
  docType: "invoice",
  id: "INV-1",
  uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
  issueDate: "2026-09-21",
  issueTime: "10:30:00",
  supplier: { name: "شركة الأمل للتجارة", vat: "399999999900003", crn: "1010010000", address: { street: "Prince Sultan", building: "3242", district: "Al Olaya", city: "Riyadh", postal: "12211" } },
  buyer: null,
  lines: [
    { name: "Dates 1kg", quantity: 10, unitCode: "KGM", netPaise: 50_000, taxPaise: 7_500, rateBp: 1500, category: "S" },
    { name: "Bottled water", quantity: 2, unitCode: "PCE", netPaise: 1_000, taxPaise: 0, rateBp: 0, category: "Z" },
  ],
  icv: 7,
  pih: FIRST_PIH,
  paymentMeans: "10",
};

describe("ZATCA invoice", () => {
  it("starts the chain with the fixed value from ZATCA's specification", () => {
    expect(FIRST_PIH).toBe("NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");
  });

  it("adds up the totals and writes the amounts to two decimals", () => {
    expect(totals(invoice)).toEqual({ net: 51_000, tax: 7_500, inclusive: 58_500, payable: 58_500, rounding: 0 });
    const xml = canonicalForHash(invoice);
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">585.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain("<cbc:UUID>7</cbc:UUID>");
    expect(xml).toContain('<cbc:TaxExemptionReasonCode>VATEX-SA-32</cbc:TaxExemptionReasonCode>');
    expect(xml).not.toContain("UBLExtensions");
    expect(xml).not.toContain("<cac:Signature>");
    expect(xml).not.toMatch(/>\s+</);
  });

  it("marks credit notes, and standard invoices ask for a delivery date and the buyer", () => {
    const credit = canonicalForHash({ ...invoice, docType: "credit", billingRef: "INV-1", reason: "Goods returned" });
    expect(credit).toContain(">381</cbc:InvoiceTypeCode>");
    expect(credit).toContain("<cac:BillingReference>");
    expect(credit).toContain("<cbc:InstructionNote>Goods returned</cbc:InstructionNote>");
    const std = canonicalForHash({ ...invoice, kind: "standard", buyer: { name: "Riyadh Stores & Co", vat: "310000000000003", address: { city: "Riyadh" } } });
    expect(std).toContain('name="0100000"');
    expect(std).toContain("<cbc:ActualDeliveryDate>2026-09-21</cbc:ActualDeliveryDate>");
    expect(std).toContain("Riyadh Stores &amp; Co");
  });

  it("hashes the same way every time, and any change alters the hash", () => {
    expect(invoiceHash(invoice)).toBe(invoiceHash({ ...invoice }));
    expect(invoiceHash(invoice)).not.toBe(invoiceHash({ ...invoice, icv: 8 }));
  });

  it("signs: the hash recomputed from the finished file matches, the signature verifies, and the QR carries all nine fields", () => {
    const keys = generateEgsKeys();
    const cert = testCertificate(keys.privateKeyPem);
    if (!cert) return; // OpenSSL not available here
    const s = signInvoice({ invoice, privateKeyPem: keys.privateKeyPem, certificate: cert, signingTime: "2026-09-21T10:30:05Z", sellerName: invoice.supplier.name, includeStamp: true });

    // Take the signature block, QR reference and signature element back out; the hash of the rest must be what we recorded.
    const stripped = s.xml
      .replace('<?xml version="1.0" encoding="UTF-8"?>', "")
      .replace(/<ext:UBLExtensions>.*<\/ext:UBLExtensions>/, "")
      .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>.*?<\/cac:AdditionalDocumentReference>/, "")
      .replace(/<cac:Signature>.*?<\/cac:Signature>/, "");
    expect(createHash("sha256").update(stripped).digest("base64")).toBe(s.hash);
    expect(s.xml).toContain(`<ds:DigestValue>${s.hash}</ds:DigestValue>`);

    const ok = createVerify("sha256").update(Buffer.from(s.hash, "base64")).verify(createPublicKey({ key: keys.publicKeyDer, format: "der", type: "spki" }), Buffer.from(s.signature, "base64"));
    expect(ok).toBe(true);

    const tags: Record<number, Buffer> = {};
    const b = Buffer.from(s.qr, "base64");
    for (let p = 0; p < b.length; ) {
      tags[b[p]] = b.subarray(p + 2, p + 2 + b[p + 1]);
      p += 2 + b[p + 1];
    }
    expect(Object.keys(tags).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags[1].toString()).toBe("شركة الأمل للتجارة");
    expect(tags[2].toString()).toBe("399999999900003");
    expect(tags[4].toString()).toBe("585.00");
    expect(tags[5].toString()).toBe("75.00");
    expect(tags[6].toString()).toBe(s.hash);
    expect(tags[8].equals(keys.publicKeyDer)).toBe(true);
    expect(s.xml).toContain("CN=TEST-CA");
  });

  it("produces well-formed XML", () => {
    const keys = generateEgsKeys();
    const cert = testCertificate(keys.privateKeyPem);
    if (!cert) return;
    const s = signInvoice({ invoice, privateKeyPem: keys.privateKeyPem, certificate: cert, signingTime: "2026-09-21T10:30:05Z", sellerName: "x", includeStamp: false });
    const dir = mkdtempSync(path.join(tmpdir(), "zx-"));
    writeFileSync(path.join(dir, "i.xml"), s.xml);
    const r = spawnSync("xmllint", ["--noout", path.join(dir, "i.xml")], { encoding: "utf8" });
    if (r.error) return; // xmllint not installed
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
