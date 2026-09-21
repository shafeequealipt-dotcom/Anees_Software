import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { bitString, bmp, explicit, integer, oid, pem, seq, set, utf8, type Der } from "./der";

export type ZatcaEnvironment = "sandbox" | "simulation" | "production";

/** ZATCA uses the secp256k1 curve for both the certificate request and invoice signatures. */
export function generateEgsKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return {
    privateKeyPem: privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKeyDer: publicKey.export({ type: "spki", format: "der" }) as Buffer,
  };
}

export const publicKeyDerFromPrivate = (privateKeyPem: string): Buffer => createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" }) as Buffer;

/** ECDSA with SHA-256; the signature is DER encoded. */
export function ecdsaSign(privateKeyPem: string, data: Buffer): Buffer {
  return createSign("sha256").update(data).sign(createPrivateKey(privateKeyPem));
}

export interface CsrInput {
  privateKeyPem: string;
  /** Business name as registered. */
  organizationName: string;
  /** Branch or device name, e.g. "Riyadh Branch". */
  organizationUnit: string;
  /** Common name of the device, e.g. "TST-886431145-399999999900003". */
  commonName: string;
  /** VAT registration number, 15 digits. */
  vatNumber: string;
  /** "1-Vendor|2-Model|3-Unique id" */
  serialNumber: string;
  /** Which invoices this device issues: 4 digits, standard, simplified, then two reserved. "1100" = both. */
  invoiceType: string;
  /** Short national address, e.g. "RRRD2929". */
  address: string;
  businessCategory: string;
  environment: ZatcaEnvironment;
}

const rdn = (o: string, value: Der) => set(seq(oid(o), value));
const OID = { commonName: "2.5.4.3", country: "2.5.4.6", org: "2.5.4.10", unit: "2.5.4.11", sn: "2.5.4.4", uid: "0.9.2342.19200300.100.1.1", title: "2.5.4.12", regAddr: "2.5.4.26", bizCat: "2.5.4.15" };

/** Certificate request in the shape ZATCA's onboarding API expects. */
export function buildCsr(i: CsrInput): string {
  const subject = seq(
    rdn(OID.country, utf8("SA")),
    rdn(OID.unit, utf8(i.organizationUnit)),
    rdn(OID.org, utf8(i.organizationName)),
    rdn(OID.commonName, utf8(i.commonName)),
  );
  const dirName = explicit(4, seq(rdn(OID.sn, utf8(i.serialNumber)), rdn(OID.uid, utf8(i.vatNumber)), rdn(OID.title, utf8(i.invoiceType)), rdn(OID.regAddr, utf8(i.address)), rdn(OID.bizCat, utf8(i.businessCategory))));
  const template = i.environment === "production" ? "ZATCA-Code-Signing" : "PREZATCA-Code-Signing";
  const extensions = seq(
    seq(oid("1.3.6.1.4.1.311.20.2"), Buffer.concat([Buffer.from([0x04]), lengthOf(bmp(template)), bmp(template)])),
    seq(oid("2.5.29.17"), Buffer.concat([Buffer.from([0x04]), lengthOf(seq(dirName)), seq(dirName)])),
  );
  const attributes = explicit(0, seq(oid("1.2.840.113549.1.9.14"), set(extensions)));
  const info = seq(integer(0), subject, publicKeyDerFromPrivate(i.privateKeyPem), attributes);
  const signature = ecdsaSign(i.privateKeyPem, info);
  return pem("CERTIFICATE REQUEST", seq(info, seq(oid("1.2.840.10045.4.3.2")), bitString(signature)));
}

function lengthOf(d: Buffer): Buffer {
  const n = d.length;
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
