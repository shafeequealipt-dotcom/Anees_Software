/** Just enough DER (ASN.1) encoding to build a certificate request. */
export type Der = Buffer;

const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, body: Buffer): Der => Buffer.concat([Buffer.from([tag]), len(body.length), body]);

export const seq = (...items: Der[]) => tlv(0x30, Buffer.concat(items));
export const set = (...items: Der[]) => tlv(0x31, Buffer.concat(items));
export const octets = (b: Buffer) => tlv(0x04, b);
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
export const printable = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
export const bmp = (s: string) => tlv(0x1e, Buffer.from(s, "utf16le").swap16());
export const integer = (n: number) => {
  const bytes: number[] = [];
  let x = n;
  do {
    bytes.unshift(x & 0xff);
    x = Math.floor(x / 256);
  } while (x > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
};
export const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
export const explicit = (n: number, body: Der) => tlv(0xa0 | n, body);

/** "2.5.4.3" → OBJECT IDENTIFIER */
export function oid(dotted: string): Der {
  const p = dotted.split(".").map(Number);
  const out: number[] = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const chunk: number[] = [n & 0x7f];
    for (let x = n >> 7; x > 0; x >>= 7) chunk.unshift((x & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

export const pem = (label: string, der: Buffer) => `-----BEGIN ${label}-----\n${der.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END ${label}-----\n`;
