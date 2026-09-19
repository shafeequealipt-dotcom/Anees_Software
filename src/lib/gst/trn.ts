/**
 * Saudi VAT registration number (TRN): 15 digits, starting and ending with 3.
 * (ZATCA does not publish a check digit, so this is a format check only.)
 */
export function checkTrn(raw: string | null | undefined): { ok: true } | { ok: false; reason: string } {
  const v = (raw || "").trim();
  if (!/^\d+$/.test(v)) return { ok: false, reason: "A VAT number has digits only." };
  if (v.length !== 15) return { ok: false, reason: "A Saudi VAT number has exactly 15 digits." };
  if (v[0] !== "3" || v[14] !== "3") return { ok: false, reason: "A Saudi VAT number starts and ends with 3." };
  return { ok: true };
}
