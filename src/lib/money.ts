/**
 * Money and quantity helpers.
 *
 * All money is stored and calculated as whole paise (integers) so totals never
 * drift from floating-point rounding. Quantities are stored as thousandths
 * ("milli") so 1.5 kg is 1500. Percentages are basis points: 18% is 1800.
 */

export type Paise = number;
export type Milli = number;
export type BasisPoints = number;

/** Round half away from zero, the way people round money by hand. */
export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Parse a rupee string/number like "1,234.50" into paise. Returns NaN if invalid. */
export function toPaise(value: string | number | null | undefined): Paise {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return roundHalfUp(value * 100);
  const cleaned = value.replace(/[₹,\s]/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "-" || cleaned === ".") return NaN;
  return roundHalfUp(Number(cleaned) * 100);
}

/** Parse a quantity like "2.5" into milli-units. */
export function toMilli(value: string | number | null | undefined): Milli {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? roundHalfUp(n * 1000) : NaN;
}

/** Parse a percentage like "18" or "2.5" into basis points. */
export function toBasisPoints(value: string | number | null | undefined): BasisPoints {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value.replace(/[%\s]/g, ""));
  return Number.isFinite(n) ? roundHalfUp(n * 100) : NaN;
}

export function paiseToRupees(p: Paise): number {
  return p / 100;
}

export function milliToQty(m: Milli): number {
  return m / 1000;
}

export function bpToPercent(bp: BasisPoints): number {
  return bp / 100;
}

/** Indian digit grouping: 12,34,567.89 */
export function formatINR(p: Paise, opts: { symbol?: boolean; decimals?: boolean } = {}): string {
  const { symbol = true, decimals = true } = opts;
  const negative = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const s = rupees.toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  const body = decimals ? `${grouped}.${paise.toString().padStart(2, "0")}` : grouped;
  return `${negative ? "-" : ""}${symbol ? "₹" : ""}${body}`;
}

export function formatQty(m: Milli): string {
  const q = m / 1000;
  return Number.isInteger(q) ? q.toString() : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatPercent(bp: BasisPoints): string {
  const v = bp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, "")}%`;
}

/**
 * Split an amount across weights so the parts add up exactly
 * (largest-remainder method). Used for spreading a bill discount over lines.
 */
export function allocateProRata(total: Paise, weights: number[]): Paise[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((f) => f * sign);
}
