/**
 * ZATCA (Saudi e-invoicing) Phase 1 QR code: a Base64 string of TLV records
 * (tag byte, length byte, UTF-8 value) that a simplified tax invoice must carry:
 *   1 seller name, 2 VAT number, 3 invoice date-time, 4 total with VAT, 5 VAT amount.
 * This is the Phase 1 ("generation") QR. Phase 2 (integration: signed XML, cryptographic
 * stamp, clearance/reporting to ZATCA) needs onboarding certificates and is not included.
 */
export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  /** ISO 8601 date-time, e.g. 2026-09-19T10:30:00Z */
  timestamp: string;
  totalPaise: number;
  vatPaise: number;
}

function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 255) throw new Error("QR field too long");
  return Uint8Array.from([tag, bytes.length, ...bytes]);
}

const amount = (paise: number) => (paise / 100).toFixed(2);

export function zatcaQrBase64(i: ZatcaQrInput): string {
  const parts = [tlv(1, i.sellerName), tlv(2, i.vatNumber), tlv(3, i.timestamp), tlv(4, amount(i.totalPaise)), tlv(5, amount(i.vatPaise))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return btoa(String.fromCharCode(...all));
}

/** Decode a QR payload back to its fields (used by tests, and handy for support). */
export function decodeZatcaQr(b64: string): Record<number, string> {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const out: Record<number, string> = {};
  for (let i = 0; i < bytes.length; ) {
    const tag = bytes[i], len = bytes[i + 1];
    out[tag] = new TextDecoder().decode(bytes.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}
