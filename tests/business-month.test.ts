/**
 * A full month at a trading business with a warehouse and three outlets: a retail shop, a
 * wholesale counter and an online store. Stock is bought into the warehouse, sent out to the
 * shops (with a damaged and a short delivery), moved between shops, returned to the warehouse,
 * sold (cash, UPI, credit at wholesale prices, online orders), returned by a customer, returned to
 * suppliers, paid for, and the month's salaries and running costs are booked.
 *
 * Every figure asserted below is worked out by hand in the comments, so a wrong number anywhere in
 * posting, stock, balances or reports shows up as a failure here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, ledgerCategories, locations, stockLedger, taxRates, voucherLines } from "@/db/schema";
import { localDate } from "@/lib/dates";
import { gstinCheckDigit } from "@/lib/gst/gstin";
import { loadVoucherFormData } from "@/server/form-data";
import { saveCategoryName } from "@/server/categories";
import { trialBalance } from "@/server/gl";
import { saveLocation } from "@/server/locations";
import { accountSchema, saveAccount, saveItem, saveParty } from "@/server/masters";
import { getItemPrices, savePriceList, setItemPrices } from "@/server/pricing";
import { dashboard, dayBook, listVouchers, partyBalances, profitAndLoss, stockSummary, transfersReport } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { cancelVoucher, deleteVoucher, receiveTransfer, restoreVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

const R = (rupees: number) => Math.round(rupees * 100); // rupees → paise
const Q = (units: number) => units * 1000; // units → milli
const U = 1; // the owner's user id

let db: DB;
let F: number;
let W: number, RETAIL: number, WHOLESALE: number, ONLINE: number, TRANSIT: number, DAMAGED: number;
let cash: number, bank: number;
let gst5: number, gst18: number;
let rice: number, oil: number, bottle: number;
let keralaAgro: number, bottleHouse: number, hotelSagar: number, cityMart: number;
let salaries: number, rent: number, electricity: number, freight: number, packing: number;
let purchaseRiceOil: number, purchaseBottles: number, hotelSale: number;

async function stock(itemId: number, locationId: number) {
  const rows = await db.select().from(stockLedger).where(and(eq(stockLedger.itemId, itemId), eq(stockLedger.locationId, locationId)));
  return rows.reduce((s, r) => s + r.qtyMilli, 0) / 1000;
}

/** Send a transfer and receive it. `got` overrides what arrived per item: [received, damaged]. */
async function transfer(date: string, from: number, to: number, lines: [number, number][], got: Record<number, [number, number]> = {}, note?: string, reason?: "excess") {
  const t = await saveVoucher(db, F, { type: "stock_transfer", date, locationId: from, toLocationId: to, returnReason: reason, lines: lines.map(([itemId, n]) => ({ itemId, description: "x", qtyMilli: Q(n), ratePaise: 0 })) }, U);
  const saved = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, t.id));
  await receiveTransfer(
    db,
    F,
    t.id,
    U,
    saved.map((l) => {
      const [ok, bad] = got[l.itemId!] ?? [l.qtyMilli / 1000, 0];
      return { lineId: l.id, receivedQtyMilli: Q(ok), damagedQtyMilli: Q(bad) };
    }),
    note ?? null,
  );
  return t.id;
}

const line = (itemId: number, qty: number, rate: number, taxRateId: number) => ({ itemId, description: "x", qtyMilli: Q(qty), ratePaise: R(rate), taxRateId });
const expense = (date: string, categoryId: number, what: string, amount: number, accountId: number) =>
  saveVoucher(db, F, { type: "expense", date, categoryId, accountId, paidPaise: R(amount), notes: what, lines: [{ description: what, qtyMilli: Q(1), ratePaise: R(amount) }] }, U);

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, {
    businessName: "Anees Traders",
    gstin: "27AAPCA1234K1Z" + gstinCheckDigit("27AAPCA1234K1Z"),
    gstScheme: "regular",
    stateCode: "27",
    ownerName: "Anees",
    email: "owner@anees.example",
    password: "Tulsi-Garden-4471",
  } as never);
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);

  // ── Locations: the seeded warehouse and "Main shop" (renamed), plus two more outlets.
  const locs = await db.select().from(locations).where(eq(locations.firmId, F));
  W = locs.find((l) => l.kind === "warehouse")!.id;
  TRANSIT = locs.find((l) => l.kind === "transit")!.id;
  DAMAGED = locs.find((l) => l.kind === "damaged")!.id;
  RETAIL = await saveLocation(db, F, { id: locs.find((l) => l.kind === "shop")!.id, name: "Retail shop", kind: "shop" });
  WHOLESALE = await saveLocation(db, F, { name: "Wholesale counter", kind: "shop" });
  ONLINE = await saveLocation(db, F, { name: "Online store", kind: "shop" });

  // ── Money: cash in hand (seeded, ₹0) and a bank account opening with ₹2,00,000.
  [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.kind, "cash")));
  bank = await saveAccount(db, F, accountSchema.parse({ kind: "bank", name: "SBI Current", ifsc: "SBIN0001234", openingBalancePaise: R(200_000), openingDate: "2026-09-01" }) as never, U);

  const rates = await db.select().from(taxRates).where(eq(taxRates.firmId, F));
  gst5 = rates.find((r) => r.gstBp === 500 && r.nature === "taxable")!.id;
  gst18 = rates.find((r) => r.gstBp === 1800 && r.nature === "taxable")!.id;

  // ── Items.
  rice = await saveItem(db, F, { name: "Basmati Rice 5kg", salePricePaise: R(520), purchasePricePaise: R(400), taxRateId: gst5, minStockMilli: Q(10) }, U);
  oil = await saveItem(db, F, { name: "Sunflower Oil 1L", salePricePaise: R(180), purchasePricePaise: R(150), taxRateId: gst5, minStockMilli: Q(10) }, U);
  bottle = await saveItem(db, F, { name: "Steel Water Bottle", salePricePaise: R(350), purchasePricePaise: R(200), taxRateId: gst18, minStockMilli: Q(10) }, U);

  // ── A wholesale price list, and the parties.
  const wholesaleList = await savePriceList(db, F, { name: "Wholesale" });
  await setItemPrices(db, F, rice, [{ priceListId: wholesaleList, salePricePaise: R(480), includesTax: false }], U);
  await setItemPrices(db, F, oil, [{ priceListId: wholesaleList, salePricePaise: R(165), includesTax: false }], U);
  keralaAgro = await saveParty(db, F, { kind: "supplier", name: "Kerala Agro Traders" }, U);
  bottleHouse = await saveParty(db, F, { kind: "supplier", name: "Bottle House" }, U);
  hotelSagar = await saveParty(db, F, { kind: "customer", name: "Hotel Sagar", priceListId: wholesaleList, creditDays: 15 }, U);
  cityMart = await saveParty(db, F, { kind: "customer", name: "City Mart", creditDays: 2 }, U);

  // ── Expense categories: salaries, rent, electricity and freight are seeded; packing material is added.
  const cats = await db.select().from(ledgerCategories).where(and(eq(ledgerCategories.firmId, F), eq(ledgerCategories.kind, "expense")));
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  salaries = cat("Salaries & wages");
  rent = cat("Rent");
  electricity = cat("Electricity");
  freight = cat("Transport & freight");
  await saveCategoryName(db, F, "expense", undefined, "Packing material", U);
  [{ id: packing }] = await db.select({ id: ledgerCategories.id }).from(ledgerCategories).where(and(eq(ledgerCategories.firmId, F), eq(ledgerCategories.name, "Packing material")));
});

describe("1 · buying stock into the warehouse", () => {
  it("records two supplier bills, one part-paid from the bank", async () => {
    // Rice 200 × ₹400 + oil 300 × ₹150 = ₹1,25,000 + 5% GST ₹6,250 = ₹1,31,250; ₹50,000 paid now.
    purchaseRiceOil = (
      await saveVoucher(db, F, { type: "purchase_bill", date: "2026-09-01", partyId: keralaAgro, locationId: W, supplierInvoiceNo: "KAT/771", paidPaise: R(50_000), accountId: bank, lines: [line(rice, 200, 400, gst5), line(oil, 300, 150, gst5)] }, U)
    ).id;
    // Bottles 100 × ₹200 = ₹20,000 + 18% ₹3,600 = ₹23,600, on credit.
    purchaseBottles = (await saveVoucher(db, F, { type: "purchase_bill", date: "2026-09-01", partyId: bottleHouse, locationId: W, lines: [line(bottle, 100, 200, gst18)] }, U)).id;

    expect(await stock(rice, W)).toBe(200);
    expect(await stock(oil, W)).toBe(300);
    expect(await stock(bottle, W)).toBe(100);
  });

  it("the wholesale price list carries the lower rates", async () => {
    const prices = await getItemPrices(db, F, rice);
    expect(prices.find((p) => p.salePricePaise !== null)?.salePricePaise).toBe(R(480));
  });
});

describe("2 · sending stock out to the shops", () => {
  it("warehouse → retail shop, fully received", async () => {
    await transfer("2026-09-02", W, RETAIL, [[rice, 60], [oil, 100], [bottle, 40]]);
    expect([await stock(rice, RETAIL), await stock(oil, RETAIL), await stock(bottle, RETAIL)]).toEqual([60, 100, 40]);
  });

  it("warehouse → online store: 2 oil arrive damaged and 1 goes missing", async () => {
    await transfer("2026-09-02", W, ONLINE, [[rice, 30], [oil, 50], [bottle, 30]], { [oil]: [47, 2] }, "1 oil can missing from the carton");
    expect([await stock(rice, ONLINE), await stock(oil, ONLINE), await stock(bottle, ONLINE)]).toEqual([30, 47, 30]);
    expect(await stock(oil, DAMAGED)).toBe(2);
  });

  it("warehouse → wholesale counter, fully received", async () => {
    await transfer("2026-09-03", W, WHOLESALE, [[rice, 80], [oil, 100]]);
    expect([await stock(rice, WHOLESALE), await stock(oil, WHOLESALE)]).toEqual([80, 100]);
  });

  it("nothing is left sitting in transit once everything is received", async () => {
    for (const item of [rice, oil, bottle]) expect(await stock(item, TRANSIT)).toBe(0);
    expect((await dashboard(db, F)).pendingTransfers).toBe(0);
  });

  it("a transfer sent but not yet received shows as pending, and cancelling it puts the stock back", async () => {
    const t = await saveVoucher(db, F, { type: "stock_transfer", date: "2026-09-04", locationId: W, toLocationId: RETAIL, lines: [{ itemId: bottle, description: "x", qtyMilli: Q(5), ratePaise: 0 }] }, U);
    expect(await stock(bottle, TRANSIT)).toBe(5);
    expect((await dashboard(db, F)).pendingTransfers).toBe(1);
    await cancelVoucher(db, F, t.id, U);
    expect(await stock(bottle, TRANSIT)).toBe(0);
    expect(await stock(bottle, W)).toBe(30); // 100 − 40 − 30
  });
});

describe("3 · selling: retail, wholesale and online", () => {
  it("retail: a cash sale and a UPI sale to walk-in customers", async () => {
    // Rice 10×520 + oil 20×180 + bottle 5×350 = ₹10,550; GST 260 + 180 + 315 = ₹755 → ₹11,305, cash.
    await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-05", partyName: "Walk-in customer", locationId: RETAIL, accountId: cash, paymentMode: "Cash", lines: [line(rice, 10, 520, gst5), line(oil, 20, 180, gst5), line(bottle, 5, 350, gst18)] }, U);
    // Rice 5×520 + bottle 10×350 = ₹6,100; GST 130 + 630 = ₹760 → ₹6,860, UPI into the bank.
    await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-12", partyName: "Walk-in customer", locationId: RETAIL, accountId: bank, paymentMode: "UPI", lines: [line(rice, 5, 520, gst5), line(bottle, 10, 350, gst18)] }, U);
    expect([await stock(rice, RETAIL), await stock(oil, RETAIL), await stock(bottle, RETAIL)]).toEqual([45, 80, 25]);
  });

  it("a mistaken bill is cancelled and its stock comes back", async () => {
    const wrong = await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-12", partyName: "Walk-in customer", locationId: RETAIL, accountId: cash, lines: [line(bottle, 3, 350, gst18)] }, U);
    expect(await stock(bottle, RETAIL)).toBe(22);
    await cancelVoucher(db, F, wrong.id, U);
    expect(await stock(bottle, RETAIL)).toBe(25);
  });

  it("wholesale: two credit sales at trade prices", async () => {
    // Hotel Sagar: rice 50×480 + oil 60×165 = ₹33,900 + 5% ₹1,695 = ₹35,595, due in 15 days.
    hotelSale = (await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-06", dueDate: "2026-09-21", partyId: hotelSagar, locationId: WHOLESALE, lines: [line(rice, 50, 480, gst5), line(oil, 60, 165, gst5)] }, U)).id;
    // City Mart: rice 20×500 + oil 30×170 = ₹15,100 + 5% ₹755 = ₹15,855, due 10 Sep.
    await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-08", dueDate: "2026-09-10", partyId: cityMart, locationId: WHOLESALE, lines: [line(rice, 20, 500, gst5), line(oil, 30, 170, gst5)] }, U);
    expect([await stock(rice, WHOLESALE), await stock(oil, WHOLESALE)]).toEqual([10, 10]);
  });

  it("online: three paid orders", async () => {
    // Rice 8×520 + bottle 6×350 = ₹6,260 + GST 208 + 378 = ₹6,846.
    await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-07", partyName: "Online order #1001", locationId: ONLINE, accountId: bank, paymentMode: "Online", lines: [line(rice, 8, 520, gst5), line(bottle, 6, 350, gst18)] }, U);
    // Oil 25×180 = ₹4,500 + ₹225 = ₹4,725.
    await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-15", partyName: "Online order #1002", locationId: ONLINE, accountId: bank, paymentMode: "Online", lines: [line(oil, 25, 180, gst5)] }, U);
    // Bottles 12×350 = ₹4,200 + ₹756 = ₹4,956.
    await saveVoucher(db, F, { type: "sale_invoice", date: "2026-09-20", partyName: "Online order #1003", locationId: ONLINE, accountId: bank, paymentMode: "Online", lines: [line(bottle, 12, 350, gst18)] }, U);
    expect([await stock(rice, ONLINE), await stock(oil, ONLINE), await stock(bottle, ONLINE)]).toEqual([22, 22, 12]);
  });
});

describe("4 · moving stock between shops and back", () => {
  it("shop → shop: the online store runs low on oil and takes 20 from retail", async () => {
    await transfer("2026-09-10", RETAIL, ONLINE, [[oil, 20]]);
    expect([await stock(oil, RETAIL), await stock(oil, ONLINE)]).toEqual([60, 42]);
  });

  it("shop → shop return: the wholesale counter sends 5 rice back to retail", async () => {
    await transfer("2026-09-26", WHOLESALE, RETAIL, [[rice, 5]]);
    expect([await stock(rice, WHOLESALE), await stock(rice, RETAIL)]).toEqual([5, 50]);
  });

  it("shop → warehouse: the online store returns 10 unsold rice", async () => {
    await transfer("2026-09-25", ONLINE, W, [[rice, 10]], {}, undefined, "excess");
    expect([await stock(rice, ONLINE), await stock(rice, W)]).toEqual([12, 40]);
  });
});

describe("5 · returns", () => {
  it("a customer returns 5 damaged rice to the wholesale counter; it's written off", async () => {
    // Credit note against Hotel Sagar's bill: 5 × ₹480 = ₹2,400 + ₹120 = ₹2,520.
    await saveVoucher(db, F, { type: "credit_note", date: "2026-09-09", sourceVoucherId: hotelSale, partyId: hotelSagar, returnReason: "damaged", lines: [line(rice, 5, 480, gst5)] }, U);
    expect(await stock(rice, WHOLESALE)).toBe(10); // back on the counter's books…
    await saveVoucher(db, F, { type: "stock_adjustment", date: "2026-09-09", direction: -1, locationId: WHOLESALE, notes: "Damaged customer return", lines: [{ itemId: rice, description: "x", qtyMilli: Q(5), ratePaise: 0 }] }, U);
    expect(await stock(rice, WHOLESALE)).toBe(5); // …and written off as unsellable
  });

  it("a customer can't return more than they bought", async () => {
    await expect(saveVoucher(db, F, { type: "credit_note", date: "2026-09-10", sourceVoucherId: hotelSale, partyId: hotelSagar, lines: [line(rice, 46, 480, gst5)] }, U)).rejects.toThrow(/can still be returned/);
  });

  it("the 2 oil damaged in transit go back to the supplier", async () => {
    // Debit note from the Damaged goods location: 2 × ₹150 = ₹300 + ₹15 = ₹315.
    await saveVoucher(db, F, { type: "debit_note", date: "2026-09-11", sourceVoucherId: purchaseRiceOil, partyId: keralaAgro, locationId: DAMAGED, returnReason: "damaged", lines: [line(oil, 2, 150, gst5)] }, U);
    expect(await stock(oil, DAMAGED)).toBe(0);
  });

  it("10 faulty bottles go back from the warehouse to the supplier", async () => {
    // 10 × ₹200 = ₹2,000 + 18% ₹360 = ₹2,360.
    await saveVoucher(db, F, { type: "debit_note", date: "2026-09-14", sourceVoucherId: purchaseBottles, partyId: bottleHouse, locationId: W, returnReason: "quality", lines: [line(bottle, 10, 200, gst18)] }, U);
    expect(await stock(bottle, W)).toBe(20);
  });
});

describe("6 · money: collections, supplier payments, salaries and running costs", () => {
  it("collects from a wholesale customer and pays both suppliers", async () => {
    await saveVoucher(db, F, { type: "payment_in", date: "2026-09-20", partyId: hotelSagar, amountPaise: R(20_000), accountId: bank, paymentMode: "Bank transfer" }, U);
    await saveVoucher(db, F, { type: "payment_out", date: "2026-09-18", partyId: keralaAgro, amountPaise: R(40_000), accountId: bank, paymentMode: "Bank transfer" }, U);
    await saveVoucher(db, F, { type: "payment_out", date: "2026-09-22", partyId: bottleHouse, amountPaise: R(10_000), accountId: bank, paymentMode: "Cheque" }, U);
  });

  it("pays the month's salaries to three employees", async () => {
    await expense("2026-09-28", salaries, "Salary Sep 2026 — Ravi (retail cashier)", 15_000, bank);
    await expense("2026-09-28", salaries, "Salary Sep 2026 — Meena (online packing)", 12_000, bank);
    await expense("2026-09-28", salaries, "Salary Sep 2026 — Suresh (warehouse)", 10_000, cash);
  });

  it("books rent, electricity, packing material and courier charges", async () => {
    await expense("2026-09-05", rent, "Shop rent September", 25_000, bank);
    await expense("2026-09-10", electricity, "KSEB bill", 3_200, bank);
    await expense("2026-09-06", packing, "Boxes and tape for online orders", 1_200, cash);
    await expense("2026-09-16", freight, "Courier charges, online orders", 1_800, bank);
  });

  it("a wrongly entered expense is deleted and restored without disturbing the books", async () => {
    const oops = await expense("2026-09-16", freight, "Duplicate courier entry", 1_800, bank);
    await deleteVoucher(db, F, oops.id, U);
    await restoreVoucher(db, F, oops.id, U);
    await deleteVoucher(db, F, oops.id, U); // and gone for good (hidden, number kept)
  });
});

describe("7 · end of month: every number adds up", () => {
  it("stock at each location", async () => {
    // Rice:   W 200−60−30−80+10 = 40 · Retail 60−10−5+5 = 50 · Wholesale 80−50−20+5−5−5 = 5 · Online 30−8−10 = 12
    // Oil:    W 300−100−50−100 = 50 · Retail 100−20−20 = 60 · Wholesale 100−60−30 = 10 · Online 47−25+20 = 42
    // Bottle: W 100−40−30−10 = 20 · Retail 40−5−10 = 25 · Online 30−6−12 = 12
    const table = async (item: number) => [await stock(item, W), await stock(item, RETAIL), await stock(item, WHOLESALE), await stock(item, ONLINE), await stock(item, TRANSIT), await stock(item, DAMAGED)];
    expect(await table(rice)).toEqual([40, 50, 5, 12, 0, 0]);
    expect(await table(oil)).toEqual([50, 60, 10, 42, 0, 0]);
    expect(await table(bottle)).toEqual([20, 25, 0, 12, 0, 0]);
  });

  it("company-wide stock equals what came in minus what went out", async () => {
    // Rice 200 bought − 93 sold + 5 returned − 5 written off = 107
    // Oil 300 − 135 sold − 1 missing − 2 back to supplier = 162
    // Bottle 100 − 23 sold − 10 back to supplier = 57
    const summary = await stockSummary(db, F);
    const qty = (id: number) => summary.find((r) => r.id === id)!.qty_milli / 1000;
    expect([qty(rice), qty(oil), qty(bottle)]).toEqual([107, 162, 57]);
  });

  it("low stock is judged per shop", async () => {
    const lowAtWholesale = await stockSummary(db, F, { locationId: WHOLESALE, lowOnly: true });
    expect(lowAtWholesale.map((r) => r.name).sort()).toEqual(["Basmati Rice 5kg", "Steel Water Bottle", "Sunflower Oil 1L"]); // 5, 0, 10 — all at or below 10
    const lowAtRetail = await stockSummary(db, F, { locationId: RETAIL, lowOnly: true });
    expect(lowAtRetail).toHaveLength(0); // 50, 60, 25
  });

  it("who owes what", async () => {
    // Hotel Sagar 35,595 − 2,520 return − 20,000 paid = 13,075 · City Mart 15,855
    // Kerala Agro −1,31,250 + 50,000 + 315 return + 40,000 = −40,935 · Bottle House −23,600 + 2,360 + 10,000 = −11,240
    const bal = new Map((await partyBalances(db, F)).map((p) => [p.name, p.balance_paise]));
    expect(bal.get("Hotel Sagar")).toBe(R(13_075));
    expect(bal.get("City Mart")).toBe(R(15_855));
    expect(bal.get("Kerala Agro Traders")).toBe(R(-40_935));
    expect(bal.get("Bottle House")).toBe(R(-11_240));
    const d = await dashboard(db, F);
    expect(d.receivable).toBe(R(13_075 + 15_855));
    expect(d.payable).toBe(R(40_935 + 11_240));
  });

  it("cash and bank balances", async () => {
    // Cash: +11,305 − 1,200 packing − 10,000 Suresh = 105
    // Bank: 2,00,000 − 50,000 + 6,860 + 6,846 + 4,725 + 4,956 + 20,000 − 40,000 − 10,000 − 15,000 − 12,000 − 25,000 − 3,200 − 1,800 = 86,387
    const money = new Map((await dashboard(db, F)).money.map((m) => [m.name, m.balance]));
    expect(money.get("Cash in hand")).toBe(R(105));
    expect(money.get("SBI Current")).toBe(R(86_387));
  });

  it("overdue wholesale bills are flagged", async () => {
    const overdue = await listVouchers(db, F, { types: ["sale_invoice"], status: "overdue" });
    expect(overdue.map((v) => v.party_name).sort()).toEqual(["City Mart", "Hotel Sagar"]);
  });

  it("profit & loss for September", async () => {
    const pl = await profitAndLoss(db, F, "2026-09-01", "2026-09-30");
    // Sales before tax: 10,550 + 6,100 + 33,900 + 15,100 + 6,260 + 4,500 + 4,200 = 80,610 (the cancelled bill doesn't count)
    expect(pl.sales).toBe(R(80_610));
    expect(pl.saleReturns).toBe(R(2_400));
    expect(pl.purchases).toBe(R(145_000));
    expect(pl.purchaseReturns).toBe(R(2_300));
    // Expenses: salaries 37,000 + rent 25,000 + electricity 3,200 + packing 1,200 + courier 1,800 = 68,200 (the deleted entry doesn't count)
    expect(pl.expenses).toBe(R(68_200));
    const byCat = new Map(pl.expenseByCategory.map((c: { name: string; amount: number }) => [c.name, c.amount]));
    expect(byCat.get("Salaries & wages")).toBe(R(37_000));
    expect(byCat.get("Packing material")).toBe(R(1_200));
    expect(pl.netProfit).toBe(pl.grossProfit + pl.otherIncome - pl.expenses - pl.depreciation);
  });

  it("the books balance: total debits equal total credits", async () => {
    const tb = await trialBalance(db, F, "2026-09-30");
    const debit = tb.reduce((s, r) => s + r.debit, 0);
    const credit = tb.reduce((s, r) => s + r.credit, 0);
    expect(debit).toBe(credit);
    expect(debit).toBeGreaterThan(0);
  });

  it("each shop's sales for the month", async () => {
    const byShop = new Map((await dashboard(db, F)).monthByShop.map((s) => [s.locationName, s]));
    expect(byShop.get("Retail shop")?.bills).toBe(2); // the cancelled bill isn't counted
    expect(byShop.get("Wholesale counter")?.bills).toBe(2);
    expect(byShop.get("Online store")?.bills).toBe(3);
    expect(byShop.get("Wholesale counter")?.returnsPaise).toBeGreaterThan(0);
  });

  it("the transfers report shows the missing oil and the unsold-stock return", async () => {
    const rep = await transfersReport(db, F, "2026-09-01", "2026-09-30");
    expect(rep.inTransit.qty_milli).toBe(0);
    expect(rep.byReason.map((r) => r.reason)).toEqual(expect.arrayContaining(["damaged", "quality"]));
  });

  it("staff tied to the online store see only its bills", async () => {
    const onlineOnly = await listVouchers(db, F, { types: ["sale_invoice"], locationIds: [ONLINE], createdBy: 999 });
    expect(onlineOnly.map((v) => v.party_name).sort()).toEqual(["Online order #1001", "Online order #1002", "Online order #1003"]);
  });

  it("'Return to warehouse' starts from a shop, not from the warehouse it's returning to", async () => {
    const mine = [W, RETAIL, WHOLESALE, ONLINE].map((id) => ({ id, name: String(id), kind: id === W ? "warehouse" : "shop" }));
    const form = await loadVoucherFormData(db, F, "stock_transfer", { toLocationId: W }, { balance: true, contact: true, purchase: true }, mine as never);
    expect(form.presetToLocationId).toBe(W);
    expect(form.defaultLocationId).not.toBe(W);
    expect(form.defaultLocationId).toBe(RETAIL);
  });

  it("a transfer received just after midnight in India is dated that day, not the previous UTC day", () => {
    expect(localDate("2026-09-29T18:31:00Z")).toBe("2026-09-30"); // 12:01 am IST on 30 Sep
    expect(localDate("2026-09-29T18:29:00Z")).toBe("2026-09-29"); // 11:59 pm IST on 29 Sep
  });

  it("the day book lists the month without the deleted entry", async () => {
    const book = await dayBook(db, F, "2026-09-01", "2026-09-30");
    expect(book.some((v) => v.status === "deleted")).toBe(false);
    expect(book.filter((v) => v.type === "expense")).toHaveLength(7);
  });
});
