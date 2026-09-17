import { isValidStateCode } from "./states";

const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Check digit of a GSTIN (15th character), computed over the first 14 characters. */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinCheck = { ok: true; stateCode: string; pan: string } | { ok: false; reason: string };

export function checkGstin(raw: string | null | undefined): GstinCheck {
  const gstin = (raw || "").trim().toUpperCase();
  if (gstin.length !== 15) return { ok: false, reason: "A GSTIN has exactly 15 characters." };
  if (!GSTIN_PATTERN.test(gstin)) return { ok: false, reason: "This doesn't match the GSTIN format (e.g. 27ABCDE1234F1Z5)." };
  const stateCode = gstin.slice(0, 2);
  if (!isValidStateCode(stateCode)) return { ok: false, reason: `"${stateCode}" isn't a valid state code.` };
  if (gstinCheckDigit(gstin.slice(0, 14)) !== gstin[14]) {
    return { ok: false, reason: "The last character doesn't match — check for a typo." };
  }
  return { ok: true, stateCode, pan: gstin.slice(2, 12) };
}

export function normalizeGstin(raw: string | null | undefined): string | null {
  const g = (raw || "").trim().toUpperCase();
  return g ? g : null;
}
