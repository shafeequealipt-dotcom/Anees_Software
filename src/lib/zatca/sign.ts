import { createHash, X509Certificate } from "node:crypto";
import { assembleSigned, canonicalForHash, type ZatcaInvoice } from "./invoice";
import { ecdsaSign, publicKeyDerFromPrivate } from "./csr";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data);

/** Base64 of the SHA-256 of the previous invoice's hash "0", as ZATCA defines the first link of the chain. */
export const FIRST_PIH = Buffer.from(sha256("0").digest("hex")).toString("base64");

/** The invoice hash: SHA-256 of the canonical document, in base64. It is also the next invoice's "previous hash". */
export function invoiceHash(inv: ZatcaInvoice): string {
  return sha256(canonicalForHash(inv)).digest("base64");
}

const tlv = (tag: number, value: Buffer) => Buffer.concat([Buffer.from([tag, value.length]), value]);

export interface QrInput {
  sellerName: string;
  vat: string;
  timestamp: string;
  totalPaise: number;
  vatPaise: number;
  hash: string;
  signature: string;
  publicKey: Buffer;
  /** Signature of ZATCA's certificate over our certificate; only on simplified invoices. */
  certSignature?: Buffer;
}

/** Phase 2 QR: the Phase 1 fields plus the invoice hash, signature and keys, so anyone can check the invoice offline. */
export function qrPhase2(q: QrInput): string {
  const t = (n: number, s: string) => tlv(n, Buffer.from(s, "utf8"));
  const parts = [t(1, q.sellerName), t(2, q.vat), t(3, q.timestamp), t(4, (q.totalPaise / 100).toFixed(2)), t(5, (q.vatPaise / 100).toFixed(2)), t(6, q.hash), t(7, q.signature), tlv(8, q.publicKey)];
  if (q.certSignature) parts.push(tlv(9, q.certSignature));
  return Buffer.concat(parts).toString("base64");
}

/** The last BIT STRING of an X.509 certificate is the issuer's signature over it. */
export function certificateSignatureBytes(der: Buffer): Buffer {
  let p = 0;
  const readLen = () => {
    const b = der[p++];
    if (b < 0x80) return b;
    let n = 0;
    for (let i = 0; i < (b & 0x7f); i++) n = n * 256 + der[p++];
    return n;
  };
  p++; // outer SEQUENCE
  readLen();
  for (let i = 0; i < 2; i++) {
    p++; // tbsCertificate, then signatureAlgorithm
    p += readLen();
  }
  p++; // BIT STRING
  const n = readLen();
  return der.subarray(p + 1, p + n); // skip the "unused bits" byte
}

export interface SignInput {
  invoice: ZatcaInvoice;
  privateKeyPem: string;
  /** The device certificate, as returned by ZATCA (PEM or the bare base64 body). */
  certificate: string;
  signingTime: string;
  sellerName: string;
  /** Simplified invoices carry ZATCA's stamp in the QR code. */
  includeStamp: boolean;
}

export interface Signed {
  xml: string;
  hash: string;
  qr: string;
  signature: string;
}

const normalisePem = (c: string) => (c.includes("BEGIN CERTIFICATE") ? c : `-----BEGIN CERTIFICATE-----\n${c.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----\n`);

/** "CN=Name, DC=extgazt, DC=gov, DC=local" — most general part last, as ZATCA prints it. */
export function issuerName(cert: X509Certificate): string {
  return cert.issuer.split("\n").reverse().join(", ");
}

export function signInvoice(i: SignInput): Signed {
  const cert = new X509Certificate(normalisePem(i.certificate));
  const certBody = cert.raw.toString("base64");
  const hash = invoiceHash(i.invoice);
  const signature = ecdsaSign(i.privateKeyPem, Buffer.from(hash, "base64")).toString("base64");

  // ZATCA's samples write the certificate and signed-properties digests as base64 of the hex text.
  const certDigest = Buffer.from(sha256(certBody).digest("hex")).toString("base64");
  const serial = BigInt("0x" + cert.serialNumber).toString();
  const signedProps =
    `<xades:SignedProperties xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${i.signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${issuerName(cert)}</ds:X509IssuerName><ds:X509SerialNumber>${serial}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;
  const propsDigest = Buffer.from(sha256(signedProps).digest("hex")).toString("base64");

  const transforms = ["not(//ancestor-or-self::ext:UBLExtensions)", "not(//ancestor-or-self::cac:Signature)", "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"]
    .map((x) => `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${x}</ds:XPath></ds:Transform>`)
    .join("");
  const ext =
    `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent>` +
    `<sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">` +
    `<sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>` +
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms>${transforms}<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${hash}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${propsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>` +
    `<ds:SignatureValue>${signature}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedProps.replace(' xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"', "")}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;

  const vat = i.invoice.supplier.vat ?? "";
  const totals = i.invoice.lines.reduce((s, l) => s + l.netPaise + l.taxPaise, 0) + (i.invoice.roundingPaise ?? 0);
  const taxTotal = i.invoice.lines.reduce((s, l) => s + l.taxPaise, 0);
  const qr = qrPhase2({
    sellerName: i.sellerName,
    vat,
    timestamp: `${i.invoice.issueDate}T${i.invoice.issueTime}`,
    totalPaise: totals,
    vatPaise: taxTotal,
    hash,
    signature,
    publicKey: publicKeyDerFromPrivate(i.privateKeyPem),
    certSignature: i.includeStamp ? certificateSignatureBytes(cert.raw) : undefined,
  });
  return { xml: assembleSigned(i.invoice, ext, qr), hash, qr, signature };
}
