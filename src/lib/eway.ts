/**
 * E-way bill JSON for the GST portal's bulk upload (ewaybillgst.gov.in → Generate in bulk).
 * We prepare the file; the person uploads it on the portal, which validates it and issues the number.
 * Kept free of the database so the mapping can be tested on its own.
 */
export interface EwayInput {
  firm: { gstin: string; name: string; address: string | null; city: string | null; pincode: string | null; stateCode: string | null };
  bill: {
    number: string;
    date: string; // yyyy-mm-dd
    partyGstin: string | null;
    partyName: string | null;
    billingAddress: string | null;
    shippingAddress: string | null;
    placeOfSupply: string | null;
    partyStateCode: string | null;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
    totalPaise: number;
    vehicleNo: string | null;
    transportName: string | null;
    otherValuePaise: number;
  };
  lines: { description: string; hsn: string | null; qtyMilli: number; unitCode: string | null; taxablePaise: number; gstBp: number; cessBp: number; intra: boolean }[];
}

const rupees = (p: number) => Math.round(p) / 100;
const num = (s: string | null | undefined) => (s && /^\d+$/.test(s) ? Number(s) : null);

/** A six-digit PIN code found in an address. */
export function pincodeFrom(address: string | null | undefined): string | null {
  const m = address?.match(/\b[1-9]\d{5}\b/);
  return m ? m[0] : null;
}

/** UQC codes the portal accepts. Anything else falls back to OTH. */
const UQC = new Set(["BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM", "CCM", "CMS", "CTN", "DOZ", "DRM", "GGK", "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR", "MTS", "NOS", "OTH", "PAC", "PCS", "PRS", "QTL", "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD", "TON", "TUB", "UGS", "UNT", "YDS"]);

export function buildEwayBill(i: EwayInput): { ok: true; json: object } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const fromPin = pincodeFrom(i.firm.pincode) ?? pincodeFrom(i.firm.address);
  const toAddress = i.bill.shippingAddress || i.bill.billingAddress;
  const toPin = pincodeFrom(toAddress);
  const fromState = num(i.firm.stateCode);
  const toState = num(i.bill.placeOfSupply ?? i.bill.partyStateCode);
  if (!i.firm.gstin) problems.push("Your company's GSTIN is missing (Settings → This company).");
  if (!fromPin) problems.push("Your company's PIN code is missing (Settings → This company).");
  if (!fromState) problems.push("Your company's state is missing (Settings → This company).");
  if (!toPin) problems.push("The customer's address needs a 6-digit PIN code.");
  if (!toState) problems.push("The customer's state (place of supply) is missing.");
  if (i.lines.length === 0) problems.push("The bill has no items.");
  i.lines.forEach((l, n) => {
    if (l.hsn && !/^\d{4,8}$/.test(l.hsn)) problems.push(`Line ${n + 1}: HSN code must be 4 to 8 digits.`);
    if (!l.hsn) problems.push(`Line ${n + 1}: "${l.description}" has no HSN code.`);
  });
  if (problems.length) return { ok: false, problems };

  const [y, m, d] = i.bill.date.split("-");
  const intra = i.lines.every((l) => l.intra);
  const json = {
    version: "1.0.0621",
    billLists: [
      {
        userGstin: i.firm.gstin,
        supplyType: "O",
        subSupplyType: 1,
        subSupplyDesc: "",
        docType: "INV",
        docNo: i.bill.number,
        docDate: `${d}/${m}/${y}`,
        fromGstin: i.firm.gstin,
        fromTrdName: i.firm.name,
        fromAddr1: (i.firm.address ?? "").split("\n")[0].slice(0, 120),
        fromAddr2: (i.firm.address ?? "").split("\n")[1]?.slice(0, 120) ?? "",
        fromPlace: i.firm.city ?? "",
        fromPincode: Number(fromPin),
        actFromStateCode: fromState,
        fromStateCode: fromState,
        toGstin: i.bill.partyGstin || "URP",
        toTrdName: i.bill.partyName ?? "",
        toAddr1: (toAddress ?? "").split("\n")[0].slice(0, 120),
        toAddr2: (toAddress ?? "").split("\n")[1]?.slice(0, 120) ?? "",
        toPlace: "",
        toPincode: Number(toPin),
        actToStateCode: toState,
        toStateCode: toState,
        transactionType: 1,
        otherValue: rupees(i.bill.otherValuePaise),
        totalValue: rupees(i.bill.taxablePaise),
        cgstValue: rupees(i.bill.cgstPaise),
        sgstValue: rupees(i.bill.sgstPaise),
        igstValue: rupees(i.bill.igstPaise),
        cessValue: rupees(i.bill.cessPaise),
        cessNonAdvolValue: 0,
        totInvValue: rupees(i.bill.totalPaise),
        transporterId: "",
        transporterName: i.bill.transportName ?? "",
        transDocNo: "",
        transMode: i.bill.vehicleNo ? "1" : "",
        transDistance: "0",
        transDocDate: "",
        vehicleNo: (i.bill.vehicleNo ?? "").replace(/[\s-]/g, "").toUpperCase(),
        vehicleType: "R",
        itemList: i.lines.map((l, n) => ({
          itemNo: n + 1,
          productName: l.description.slice(0, 100),
          productDesc: l.description.slice(0, 100),
          hsnCode: Number(l.hsn),
          quantity: Math.round(l.qtyMilli) / 1000,
          qtyUnit: l.unitCode && UQC.has(l.unitCode.toUpperCase()) ? l.unitCode.toUpperCase() : "OTH",
          taxableAmount: rupees(l.taxablePaise),
          sgstRate: intra ? l.gstBp / 200 : 0,
          cgstRate: intra ? l.gstBp / 200 : 0,
          igstRate: intra ? 0 : l.gstBp / 100,
          cessRate: l.cessBp / 100,
          cessNonAdvol: 0,
        })),
      },
    ],
  };
  return { ok: true, json };
}
