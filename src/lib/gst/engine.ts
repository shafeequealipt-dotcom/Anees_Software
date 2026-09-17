import { allocateProRata, roundHalfUp, type BasisPoints, type Milli, type Paise } from "../money";

/**
 * GST calculation for one voucher (invoice, bill, return, quotation...).
 *
 * Order of operations for each line:
 *   gross      = qty × rate
 *   net        = gross − line discount − share of bill discount
 *   taxable    = net                      (rate excludes tax)
 *              = net − tax inside it      (rate includes tax)
 *   CGST/SGST  = taxable × (GST% ÷ 2) each, for supplies within the state
 *   IGST       = taxable × GST%,          for supplies to another state
 *   cess       = taxable × cess%
 * The bill total is the sum of line totals, optionally rounded to the nearest rupee.
 */

export type SupplyKind = "intra" | "inter";

export interface LineInput {
  qtyMilli: Milli;
  ratePaise: Paise;
  rateIncludesTax: boolean;
  /** Either a percentage discount or a fixed amount. Percentage wins if both are set. */
  discountBp?: BasisPoints;
  discountPaise?: Paise;
  gstBp: BasisPoints;
  cessBp?: BasisPoints;
}

export interface VoucherInput {
  lines: LineInput[];
  supply: SupplyKind;
  /** Discount on the whole bill, spread over lines in proportion to their value. */
  billDiscountPaise?: Paise;
  billDiscountBp?: BasisPoints;
  roundOff: boolean;
  /** Bill of supply (composition dealer, exempt sale, or unregistered business): no tax charged. */
  withoutTax?: boolean;
}

export interface LineResult {
  grossPaise: Paise;
  lineDiscountPaise: Paise;
  billDiscountPaise: Paise;
  taxablePaise: Paise;
  gstBp: BasisPoints;
  cessBp: BasisPoints;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  totalPaise: Paise;
}

export interface RateSummary {
  gstBp: BasisPoints;
  cessBp: BasisPoints;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
}

export interface VoucherResult {
  lines: LineResult[];
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  taxPaise: Paise;
  beforeRoundOffPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  byRate: RateSummary[];
}

function pct(amount: Paise, bp: BasisPoints): Paise {
  return roundHalfUp((amount * bp) / 10000);
}

export function lineGross(line: Pick<LineInput, "qtyMilli" | "ratePaise">): Paise {
  return roundHalfUp((line.qtyMilli * line.ratePaise) / 1000);
}

export function calculateVoucher(input: VoucherInput): VoucherResult {
  const withoutTax = !!input.withoutTax;

  const pre = input.lines.map((l) => {
    const gross = lineGross(l);
    const lineDiscount = l.discountBp ? pct(gross, l.discountBp) : Math.min(l.discountPaise ?? 0, gross);
    return { l, gross, lineDiscount, afterLineDiscount: gross - lineDiscount };
  });

  const baseForBillDiscount = pre.reduce((s, p) => s + p.afterLineDiscount, 0);
  let billDiscountTotal = input.billDiscountBp
    ? pct(baseForBillDiscount, input.billDiscountBp)
    : (input.billDiscountPaise ?? 0);
  billDiscountTotal = Math.max(0, Math.min(billDiscountTotal, baseForBillDiscount));
  const shares = allocateProRata(
    billDiscountTotal,
    pre.map((p) => Math.max(0, p.afterLineDiscount)),
  );

  const lines: LineResult[] = pre.map((p, i) => {
    const gstBp = withoutTax ? 0 : p.l.gstBp;
    const cessBp = withoutTax ? 0 : (p.l.cessBp ?? 0);
    const net = p.afterLineDiscount - shares[i];

    let taxable: Paise;
    let cgst = 0, sgst = 0, igst = 0, cess = 0;

    const taxOn = (base: Paise) => {
      if (input.supply === "intra") {
        const half = pct(base, gstBp / 2);
        return { cgst: half, sgst: half, igst: 0, cess: pct(base, cessBp) };
      }
      return { cgst: 0, sgst: 0, igst: pct(base, gstBp), cess: pct(base, cessBp) };
    };

    if (p.l.rateIncludesTax && (gstBp > 0 || cessBp > 0)) {
      const estimate = roundHalfUp((net * 10000) / (10000 + gstBp + cessBp));
      ({ cgst, sgst, igst, cess } = taxOn(estimate));
      // Keep the customer-facing amount exactly as entered; any paisa of rounding goes to taxable value.
      taxable = net - cgst - sgst - igst - cess;
    } else {
      taxable = net;
      ({ cgst, sgst, igst, cess } = taxOn(taxable));
    }

    return {
      grossPaise: p.gross,
      lineDiscountPaise: p.lineDiscount,
      billDiscountPaise: shares[i],
      taxablePaise: taxable,
      gstBp,
      cessBp,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      cessPaise: cess,
      totalPaise: taxable + cgst + sgst + igst + cess,
    };
  });

  const sum = (f: (r: LineResult) => number) => lines.reduce((s, r) => s + f(r), 0);
  const cgstPaise = sum((r) => r.cgstPaise);
  const sgstPaise = sum((r) => r.sgstPaise);
  const igstPaise = sum((r) => r.igstPaise);
  const cessPaise = sum((r) => r.cessPaise);
  const beforeRoundOffPaise = sum((r) => r.totalPaise);
  const totalPaise = input.roundOff ? roundHalfUp(beforeRoundOffPaise / 100) * 100 : beforeRoundOffPaise;

  const rateMap = new Map<string, RateSummary>();
  for (const r of lines) {
    const key = `${r.gstBp}:${r.cessBp}`;
    const s = rateMap.get(key) ?? {
      gstBp: r.gstBp, cessBp: r.cessBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
    };
    s.taxablePaise += r.taxablePaise;
    s.cgstPaise += r.cgstPaise;
    s.sgstPaise += r.sgstPaise;
    s.igstPaise += r.igstPaise;
    s.cessPaise += r.cessPaise;
    rateMap.set(key, s);
  }

  return {
    lines,
    grossPaise: sum((r) => r.grossPaise),
    discountPaise: sum((r) => r.lineDiscountPaise + r.billDiscountPaise),
    taxablePaise: sum((r) => r.taxablePaise),
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    taxPaise: cgstPaise + sgstPaise + igstPaise + cessPaise,
    beforeRoundOffPaise,
    roundOffPaise: totalPaise - beforeRoundOffPaise,
    totalPaise,
    byRate: [...rateMap.values()].sort((a, b) => a.gstBp - b.gstBp || a.cessBp - b.cessBp),
  };
}

/** Within-state supply when the place of supply is the seller's own state. */
export function supplyKind(sellerStateCode: string | null | undefined, placeOfSupply: string | null | undefined): SupplyKind {
  if (!sellerStateCode || !placeOfSupply) return "intra";
  return sellerStateCode === placeOfSupply ? "intra" : "inter";
}
