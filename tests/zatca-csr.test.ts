import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsr, ecdsaSign, generateEgsKeys } from "@/lib/zatca/csr";
import { createPublicKey, createVerify } from "node:crypto";

const input = { organizationName: "Al Amal Trading Est.", organizationUnit: "Riyadh Branch", commonName: "TST-886431145-399999999900003", vatNumber: "399999999900003", serialNumber: "1-TST|2-TST|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f", invoiceType: "1100", address: "RRRD2929", businessCategory: "Supply activities", environment: "sandbox" as const };

describe("ZATCA keys and certificate request", () => {
  it("makes a secp256k1 key whose signatures verify", () => {
    const k = generateEgsKeys();
    const sig = ecdsaSign(k.privateKeyPem, Buffer.from("hello"));
    const ok = createVerify("sha256").update("hello").verify(createPublicKey({ key: k.publicKeyDer, format: "der", type: "spki" }), sig);
    expect(ok).toBe(true);
  });

  it("builds a CSR that OpenSSL accepts, with the ZATCA subject and extensions", () => {
    const k = generateEgsKeys();
    const csr = buildCsr({ ...input, privateKeyPem: k.privateKeyPem });
    expect(csr).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----/);
    let text: string;
    try {
      const dir = mkdtempSync(path.join(tmpdir(), "csr-"));
      const f = path.join(dir, "r.csr");
      writeFileSync(f, csr);
      text = execFileSync("openssl", ["req", "-in", f, "-noout", "-text", "-verify"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      // OpenSSL isn't installed here; the structure was still built without errors.
      if ((e as { code?: string }).code === "ENOENT") return;
      throw e;
    }
    expect(text).toContain("C=SA");
    expect(text).toContain("O=Al Amal Trading Est.");
    expect(text).toContain("OU=Riyadh Branch");
    expect(text).toContain("CN=TST-886431145-399999999900003");
    expect(text).toMatch(/secp256k1/);
    expect(text).toContain("ecdsa-with-SHA256");
    expect(text).toContain("399999999900003");
    expect(text).toContain("RRRD2929");
  });

  it("uses the production template name for a production request", () => {
    const k = generateEgsKeys();
    const sandbox = buildCsr({ ...input, privateKeyPem: k.privateKeyPem });
    const prod = buildCsr({ ...input, environment: "production", privateKeyPem: k.privateKeyPem });
    expect(Buffer.from(sandbox.replace(/-----[^-]+-----|\n/g, ""), "base64").includes(Buffer.from("PREZATCA-Code-Signing", "utf16le").swap16())).toBe(true);
    const prodBytes = Buffer.from(prod.replace(/-----[^-]+-----|\n/g, ""), "base64");
    expect(prodBytes.includes(Buffer.from("ZATCA-Code-Signing", "utf16le").swap16())).toBe(true);
    expect(prodBytes.includes(Buffer.from("PREZATCA-Code-Signing", "utf16le").swap16())).toBe(false);
  });
});
