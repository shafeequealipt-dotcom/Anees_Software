import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, items, taxRates, units } from "@/db/schema";
import { financialYear, todayIST } from "@/lib/dates";
import { accountSchema } from "@/server/masters";
import { saveAccount, saveItem, saveParty } from "@/server/masters";
import { accountStatement, dashboard, dayBook, itemSales, listVouchers, partyBalances, partyStatement, profitAndLoss, stockSummary } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { cancelVoucher, getVoucher, openBills, saveVoucher, VoucherError } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let cashId: number;
let bankId: number;
let gst18: number;
let gst5: number;
let pcs: number;
let box: number;
let customer: number;
let outOfState: number;
let supplier: number;
let pen: number;
let notebook: number;
let service: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, {
    businessName: "Test Traders",
    gstin: "27ABCDE1234F1Z" + (await import("@/lib/gst/gstin")).gstinCheckDigit("27ABCDE1234F1Z"),
    gstScheme: "regular",
    stateCode: "27",
    ownerName: "Owner",
    email: "owner@example.com",
    password: "Tulsi-Garden-4471",
  });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  [{ id: cashId }] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "cash"));
  bankId = await saveAccount(db, firmId, accountSchema.parse({ kind: "bank", name: "HDFC Current", ifsc: "HDFC0001234", openingBalancePaise: 5_000_000 }) as never, 1);
  const rates = await db.select().from(taxRates);
  gst18 = rates.find((r) => r.gstBp === 1800)!.id;
  gst5 = rates.find((r) => r.gstBp === 500)!.id;
  const u = await db.select().from(units);
  pcs = u.find((x) => x.code === "PCS")!.id;
  box = u.find((x) => x.code === "BOX")!.id;

  customer = await saveParty(db, firmId, { kind: "customer", name: "Ravi Stores", phone: "9876543210", stateCode: "27", openingBalancePaise: 100_000, creditDays: 15 }, 1);
  outOfState = await saveParty(db, firmId, { kind: "customer", name: "Bengaluru Mart", stateCode: "29" }, 1);
  supplier = await saveParty(db, firmId, { kind: "supplier", name: "Paper Mills", stateCode: "27", openingBalancePaise: -50_000 }, 1);

  pen = await saveItem(db, firmId, { name: "Blue pen", code: "PEN01", hsn: "9608", unitId: pcs, altUnitId: box, altUnitFactorMilli: 10_000, salePricePaise: 1_000, purchasePricePaise: 600, taxRateId: gst18, openingQtyMilli: 100_000, openingRatePaise: 600, minStockMilli: 20_000 }, 1);
  notebook = await saveItem(db, firmId, { name: "Notebook A5", hsn: "4820", unitId: pcs, salePricePaise: 5_000, purchasePricePaise: 3_000, taxRateId: gst5 }, 1);
  service = await saveItem(db, firmId, { kind: "service", name: "Binding service", hsn: "998912", salePricePaise: 2_000, taxRateId: gst18 }, 1);
});

describe("books end to end", () => {
  it("rejects duplicate names and bad GSTINs", async () => {
    await expect(saveParty(db, firmId, { name: "ravi stores" }, 1)).rejects.toThrow(/already exists/);
    await expect(saveParty(db, firmId, { name: "Someone", gstin: "27ABCDE1234F1ZZ" }, 1)).rejects.toThrow();
    await expect(saveItem(db, firmId, { name: "Other pen", code: "PEN01" }, 1)).rejects.toThrow(/already used/);
  });

  it("sells on credit with part payment, within the state", async () => {
    const res = await saveVoucher(db, firmId, {
      type: "sale_invoice",
      date: "2026-09-01",
      partyId: customer,
      paidPaise: 10_000,
      accountId: cashId,
      roundOff: true,
      lines: [
        { itemId: pen, description: "Blue pen", qtyMilli: 2_000, unitFactorMilli: 10_000, unitCode: "BOX", ratePaise: 10_000, taxRateId: gst18 },
        { itemId: service, description: "Binding service", qtyMilli: 1_000, ratePaise: 2_000, taxRateId: gst18 },
      ],
    }, 1);
    expect(res.number).toBe("INV-1");
    const v = (await getVoucher(db, firmId, res.id))!;
    expect(v.voucher.taxablePaise).toBe(22_000);
    expect(v.voucher.cgstPaise).toBe(1_980);
    expect(v.voucher.sgstPaise).toBe(1_980);
    expect(v.voucher.totalPaise).toBe(26_000); // ₹259.60 rounded to ₹260
    expect(v.voucher.roundOffPaise).toBe(40);
    expect(v.voucher.dueDate).toBe("2026-09-16");
    expect(v.balancePaise).toBe(16_000);

    const stock = await stockSummary(db, firmId);
    expect(stock.find((s) => s.id === pen)!.qty_milli).toBe(80_000); // 100 − 2 boxes × 10
    expect(stock.find((s) => s.id === service)).toBeUndefined();

    const bal = (await partyBalances(db, firmId)).find((p) => p.id === customer)!;
    expect(bal.balance_paise).toBe(100_000 + 16_000);
  });

  it("charges IGST to another state and uses a walk-in cash bill", async () => {
    const r = await saveVoucher(db, firmId, {
      type: "sale_invoice",
      date: "2026-09-02",
      partyId: outOfState,
      paidPaise: 0,
      roundOff: false,
      lines: [{ itemId: notebook, description: "Notebook A5", qtyMilli: 10_000, ratePaise: 5_000 }],
    }, 1);
    const v = (await getVoucher(db, firmId, r.id))!.voucher;
    expect(v.igstPaise).toBe(0); // no tax rate id given on line → uses line gstBp (0)

    const cash = await saveVoucher(db, firmId, {
      type: "sale_invoice",
      date: "2026-09-02",
      partyName: "Walk-in",
      roundOff: true,
      lines: [{ itemId: notebook, description: "Notebook A5", qtyMilli: 1_000, ratePaise: 5_250, rateIncludesTax: true, taxRateId: gst5 }],
    }, 1);
    const c = (await getVoucher(db, firmId, cash.id))!;
    expect(c.voucher.totalPaise).toBe(5_300);
    expect(c.voucher.paidPaise).toBe(5_300);
    expect(c.voucher.accountId).toBe(cashId);
    expect(c.balancePaise).toBe(0);
  });

  it("settles oldest bills first when a payment comes in", async () => {
    const p = await saveVoucher(db, firmId, { type: "payment_in", date: "2026-09-05", partyId: customer, amountPaise: 20_000, accountId: bankId, paymentMode: "UPI" }, 1);
    const pay = (await getVoucher(db, firmId, p.id))!;
    expect(pay.settles.reduce((s, a) => s + a.amountPaise, 0)).toBe(16_000);
    const open = await openBills(db, customer, ["sale_invoice"]);
    expect(open).toHaveLength(0);
    const st = await partyStatement(db, customer, "2026-09-01", "2026-09-30");
    expect(st.openingPaise).toBe(100_000);
    expect(st.closingPaise).toBe(100_000 + 16_000 - 20_000);
  });

  it("buys stock on credit and pays part of it", async () => {
    const r = await saveVoucher(db, firmId, {
      type: "purchase_bill",
      date: "2026-09-03",
      partyId: supplier,
      supplierInvoiceNo: "PM/778",
      roundOff: false,
      lines: [{ itemId: notebook, description: "Notebook A5", qtyMilli: 50_000, ratePaise: 3_000, taxRateId: gst5 }],
    }, 1);
    expect((await getVoucher(db, firmId, r.id))!.voucher.totalPaise).toBe(157_500);
    await saveVoucher(db, firmId, { type: "payment_out", date: "2026-09-10", partyId: supplier, amountPaise: 100_000, accountId: bankId, paymentMode: "Bank transfer" }, 1);
    const sup = (await partyBalances(db, firmId)).find((p) => p.id === supplier)!;
    expect(sup.balance_paise).toBe(-50_000 - 157_500 + 100_000);
    const stock = await stockSummary(db, firmId);
    expect(stock.find((s) => s.id === notebook)!.qty_milli).toBe(50_000 - 10_000 - 1_000);
  });

  it("records a sale return against the invoice", async () => {
    const [inv] = await listVouchers(db, firmId, { types: ["sale_invoice"], partyId: customer });
    const r = await saveVoucher(db, firmId, {
      type: "credit_note",
      date: "2026-09-06",
      partyId: customer,
      sourceVoucherId: inv.id,
      roundOff: false,
      lines: [{ itemId: pen, description: "Blue pen", qtyMilli: 5_000, ratePaise: 1_000, taxRateId: gst18 }],
    }, 1);
    expect(r.number).toBe("CN-1");
    const stock = await stockSummary(db, firmId);
    expect(stock.find((s) => s.id === pen)!.qty_milli).toBe(85_000);
  });

  it("edits an invoice and rewrites balances, stock and numbers", async () => {
    const [inv] = (await listVouchers(db, firmId, { types: ["sale_invoice"], partyId: outOfState }));
    const before = (await getVoucher(db, firmId, inv.id))!;
    await saveVoucher(db, firmId, {
      id: inv.id,
      type: "sale_invoice",
      date: before.voucher.date,
      partyId: outOfState,
      roundOff: false,
      lines: [{ itemId: notebook, description: "Notebook A5", qtyMilli: 4_000, ratePaise: 5_000, taxRateId: gst5 }],
    }, 1);
    const after = (await getVoucher(db, firmId, inv.id))!;
    expect(after.voucher.number).toBe(before.voucher.number);
    expect(after.voucher.igstPaise).toBe(1_000);
    expect(after.voucher.totalPaise).toBe(21_000);
    const stock = await stockSummary(db, firmId);
    expect(stock.find((s) => s.id === notebook)!.qty_milli).toBe(50_000 - 4_000 - 1_000);
    await expect(saveVoucher(db, firmId, { type: "sale_invoice", number: 1, date: "2026-09-09", partyName: "x", lines: [{ description: "x", qtyMilli: 1000, ratePaise: 100 }] }, 1)).rejects.toThrow(/already used/);
  });

  it("cancelling removes the effect but keeps the record", async () => {
    const r = await saveVoucher(db, firmId, { type: "expense", date: "2026-09-07", roundOff: false, accountId: cashId, lines: [{ description: "Shop rent", qtyMilli: 1_000, ratePaise: 200_000 }] }, 1);
    const cashBefore = (await accountStatement(db, cashId, "2026-01-01", "2026-12-31")).closingPaise;
    await cancelVoucher(db, firmId, r.id, 1);
    const cashAfter = (await accountStatement(db, cashId, "2026-01-01", "2026-12-31")).closingPaise;
    expect(cashAfter - cashBefore).toBe(200_000);
    expect((await getVoucher(db, firmId, r.id))!.voucher.status).toBe("cancelled");
  });

  it("moves money between accounts and adjusts stock", async () => {
    await saveVoucher(db, firmId, { type: "money_transfer", date: "2026-09-08", amountPaise: 5_000, accountId: cashId, toAccountId: bankId }, 1);
    await expect(saveVoucher(db, firmId, { type: "money_transfer", date: "2026-09-08", amountPaise: 5_000, accountId: cashId, toAccountId: cashId }, 1)).rejects.toThrow(VoucherError);
    const adj = await saveVoucher(db, firmId, { type: "stock_adjustment", date: "2026-09-08", direction: -1, lines: [{ itemId: pen, description: "Blue pen", qtyMilli: 70_000, ratePaise: 0 }] }, 1);
    expect(adj.warnings).toHaveLength(0);
    const low = await stockSummary(db, firmId, { lowOnly: true });
    expect(low.map((s) => s.id)).toContain(pen);
  });

  it("produces consistent reports", async () => {
    const pl = await profitAndLoss(db, firmId, "2026-09-01", "2026-09-30");
    expect(pl.sales).toBe(22_000 + 20_000 + 5_000);
    expect(pl.saleReturns).toBe(5_000);
    expect(pl.purchases).toBe(150_000);
    expect(pl.grossProfit).toBe(pl.netSales - pl.costOfGoodsSold);
    const d = await dashboard(db, firmId);
    expect(d.receivable).toBeGreaterThan(0);
    const book = await dayBook(db, firmId, "2026-09-01", "2026-09-30");
    expect(book.length).toBeGreaterThan(5);
    const bySale = await itemSales(db, firmId, "2026-09-01", "2026-09-30");
    expect(bySale.find((r) => r.item_id === pen)!.qty_milli).toBe(20_000 - 5_000);
    const inv = await listVouchers(db, firmId, { types: ["sale_invoice"], status: "open" });
    expect(inv.every((r) => r.balance_paise > 0)).toBe(true);
  });

  it("counts opening stock dated on the financial-year start as opening, not as a same-day purchase", async () => {
    // Items were seeded with no explicit opening date, so they default to 1 April of the
    // current financial year — the same day profitAndLoss(fy.from, ...) treats as "from".
    // Regression test for a bug where that same-day collision made opening stock read as
    // zero and silently pushed its value into cost of goods sold instead.
    const fy = financialYear(todayIST());
    const pl = await profitAndLoss(db, firmId, fy.from, "2026-09-30");
    expect(pl.openingStock).toBe(60_000); // pen: 100 pcs opening qty × ₹6.00 purchase price
  });

  it("keeps items with history instead of deleting them", async () => {
    const { deleteItem } = await import("@/server/masters");
    expect(await deleteItem(db, firmId, pen, 1)).toBe("deactivated");
    const [p] = await db.select().from(items).where(eq(items.id, pen));
    expect(p.active).toBe(false);
  });
});
