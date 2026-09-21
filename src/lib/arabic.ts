/**
 * Arabic amount in words for Saudi riyals and halalas, following the usual invoice wording:
 * "مائتان وخمسون ريالاً سعودياً وثلاثون هللة فقط لا غير".
 * The riyal is a masculine noun and the halala a feminine one, which changes the number words for 1-10.
 */
const MASC_ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة"];
const FEM_ONES = ["", "واحدة", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثمان", "تسع", "عشر"];
const MASC_TEENS = ["أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const FEM_TEENS = ["إحدى عشرة", "اثنتا عشرة", "ثلاث عشرة", "أربع عشرة", "خمس عشرة", "ست عشرة", "سبع عشرة", "ثماني عشرة", "تسع عشرة"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

/** 1..999 in Arabic. */
function below1000(n: number, feminine: boolean): string {
  const ones = feminine ? FEM_ONES : MASC_ONES;
  const teens = feminine ? FEM_TEENS : MASC_TEENS;
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r <= 10) parts.push(ones[r]);
    else if (r < 20) parts.push(teens[r - 11]);
    else {
      const t = Math.floor(r / 10);
      const o = r % 10;
      parts.push(o ? `${ones[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

const SCALES: { value: number; one: string; two: string; few: string; many: string }[] = [
  { value: 1_000_000_000, one: "مليار", two: "ملياران", few: "مليارات", many: "مليار" },
  { value: 1_000_000, one: "مليون", two: "مليونان", few: "ملايين", many: "مليون" },
  { value: 1_000, one: "ألف", two: "ألفان", few: "آلاف", many: "ألف" },
];

export function arabicNumberWords(n: number, feminine = false): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "صفر";
  const parts: string[] = [];
  let rest = n;
  for (const s of SCALES) {
    const q = Math.floor(rest / s.value);
    rest %= s.value;
    if (!q) continue;
    if (q === 1) parts.push(s.one);
    else if (q === 2) parts.push(s.two);
    else if (q <= 10) parts.push(`${below1000(q, false)} ${s.few}`);
    else parts.push(`${below1000(q, false)} ${s.many}`);
  }
  if (rest) parts.push(below1000(rest, feminine));
  return parts.join(" و");
}

/** A counted noun in the right form: 1 singular, 2 dual, 3-10 plural, 11+ singular accusative. */
function counted(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  const last2 = n % 100;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (last2 >= 3 && last2 <= 10) return forms.few;
  return forms.many;
}

/** @param halalas the amount in halalas (SAR x 100) */
export function amountInWordsArabic(halalas: number): string {
  const negative = halalas < 0;
  const abs = Math.abs(Math.round(halalas));
  const riyals = Math.floor(abs / 100);
  const minor = abs % 100;
  const parts: string[] = [];
  if (riyals > 0 || minor === 0) {
    if (riyals === 0) parts.push("صفر ريال سعودي");
    else if (riyals === 1) parts.push("ريال سعودي واحد");
    else if (riyals === 2) parts.push("ريالان سعوديان");
    else if (riyals % 100 >= 3 && riyals % 100 <= 10) parts.push(`${arabicNumberWords(riyals)} ريالات سعودية`);
    else parts.push(`${arabicNumberWords(riyals)} ريالاً سعودياً`);
  }
  if (minor > 0) {
    parts.push(minor === 1 ? "هللة واحدة" : minor === 2 ? "هللتان" : `${arabicNumberWords(minor, true)} ${counted(minor, { one: "هللة", two: "هللتان", few: "هللات", many: "هللة" })}`);
  }
  return `${negative ? "سالب " : ""}${parts.join(" و")} فقط لا غير`;
}
