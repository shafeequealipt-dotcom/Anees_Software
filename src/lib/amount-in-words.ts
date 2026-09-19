import { region } from "./region";

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** Whole number in the Indian system: crore, lakh, thousand. */
export function numberToIndianWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(numberToIndianWords(crore) + " Crore");
  if (lakh) parts.push(belowHundred(lakh) + " Lakh");
  if (thousand) parts.push(belowHundred(thousand) + " Thousand");
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** Whole number in the international system: thousand, million, billion. */
export function numberToWesternWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const scales: [number, string][] = [[1_000_000_000, "Billion"], [1_000_000, "Million"], [1_000, "Thousand"]];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    const q = Math.floor(n / size);
    if (q) parts.push(numberToWesternWords(q) + " " + name);
    n %= size;
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** 123456 minor units -> "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only" (or Riyals/Halalas). */
export function amountInWords(minorUnits: number): string {
  const r = region();
  const abs = Math.abs(Math.round(minorUnits));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const words = r.indianGrouping ? numberToIndianWords(major) : numberToWesternWords(major);
  let out = `${r.country === "SA" ? "Saudi " : ""}${words} ${r.currencyMajor}`;
  if (minor) out += ` and ${belowHundred(minor)} ${r.currencyMinor}`;
  return (minorUnits < 0 ? "Minus " : "") + out + " Only";
}
