import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations, voucherLines } from "@/db/schema";
import { loadInvoiceModel } from "@/server/invoice";
import { saveItem } from "@/server/masters";
import { listVouchers } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { sellingOnly, sellingView, withCostRates, withSellingTotals } from "@/server/transfer-view";
import { getVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let warehouseId: number;
let shopId: number;
let syrup: number;
let drops: number;
let xferId: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Transfer Co", stateCode: "29", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
  warehouseId = locs.find((l) => l.kind === "warehouse")!.id;
  shopId = locs.find((l) => l.kind === "shop")!.id;
  syrup = await saveItem(db, firmId, { name: "Astha Aid Syrup", purchasePricePaise: 193_80, salePricePaise: 340_00 }, 1);
  drops = await saveItem(db, firmId, { name: "Mullien Ear Drops", purchasePricePaise: 37_62, salePricePaise: 66_00 }, 1);
  // The warehouse sends 3 syrups and 4 drops to the shop, at cost.
  const x = await saveVoucher(
    db,
    firmId,
    {
      type: "stock_transfer",
      date: "2026-10-22",
      locationId: warehouseId,
      toLocationId: shopId,
      lines: [
        { itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 3_000, ratePaise: 193_80 },
        { itemId: drops, description: "Mullien Ear Drops", qtyMilli: 4_000, ratePaise: 37_62 },
      ],
    },
    1,
  );
  xferId = x.id;
});

describe("who sees a transfer at selling price", () => {
  it("only stock transfers, and only for people who can't see purchase prices", () => {
    expect(sellingOnly("stock_transfer", false)).toBe(true);
    expect(sellingOnly("stock_transfer", true)).toBe(false);
    expect(sellingOnly("sale_invoice", false)).toBe(false);
  });
});

describe("a transfer stored at cost", () => {
  it("keeps cost in the books and records the selling price on each line", async () => {
    const ls = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, xferId));
    expect(ls.map((l) => [l.ratePaise, l.salePricePaise])).toEqual([
      [193_80, 340_00],
      [37_62, 66_00],
    ]);
    const v = (await getVoucher(db, firmId, xferId))!.voucher;
    expect(v.totalPaise).toBe(3 * 193_80 + 4 * 37_62);
  });

  it("is shown at selling price, with no cost anywhere in it", async () => {
    const shown = await sellingView(db, firmId, (await getVoucher(db, firmId, xferId))!);
    expect(shown.lines.map((l) => [l.ratePaise, l.totalPaise])).toEqual([
      [340_00, 1020_00],
      [66_00, 264_00],
    ]);
    expect(shown.voucher.totalPaise).toBe(1284_00);
    expect(JSON.stringify(shown.lines)).not.toMatch(/19380|3762/);
  });

  it("keeps the selling price it was sent at, even if the item's price changes later", async () => {
    await saveItem(db, firmId, { id: syrup, name: "Astha Aid Syrup", purchasePricePaise: 193_80, salePricePaise: 360_00 }, 1);
    const shown = await sellingView(db, firmId, (await getVoucher(db, firmId, xferId))!);
    expect(shown.lines[0].ratePaise).toBe(340_00);
  });

  it("the transfer list and its export total at selling price", async () => {
    const rows = await listVouchers(db, firmId, { types: ["stock_transfer"] });
    const [row] = (await withSellingTotals(db, firmId, rows)).filter((r) => r.id === xferId);
    expect(row).toMatchObject({ total_paise: 1284_00, taxable_paise: 1284_00, tax_paise: 0 });
  });

  it("the printout shows selling prices when asked, cost otherwise", async () => {
    const shop = await loadInvoiceModel(db, firmId, xferId, { sellingPrice: true });
    const office = await loadInvoiceModel(db, firmId, xferId);
    expect(shop!.lines.map((l) => l.rate)).toEqual([expect.stringMatching(/340\.00/), expect.stringMatching(/66\.00/)]);
    expect(JSON.stringify(shop)).not.toMatch(/193\.80|37\.62/);
    expect(office!.lines[0].rate).toMatch(/193\.80/);
  });
});

describe("a transfer entered by shop staff who see selling prices", () => {
  it("is stored at the items' cost, whatever price the form showed", async () => {
    const input = { type: "stock_transfer" as const, date: "2026-10-22", locationId: shopId, toLocationId: warehouseId, lines: [{ itemId: drops, description: "Mullien Ear Drops", qtyMilli: 1_000, ratePaise: 66_00 }, { description: "Free text, no item", qtyMilli: 1_000, ratePaise: 5_00 }] };
    const costed = await withCostRates(db, firmId, input);
    expect(costed.lines.map((l) => l.ratePaise)).toEqual([37_62, 0]);
    const saved = await saveVoucher(db, firmId, costed, 1);
    const [line] = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, saved.id));
    expect([line.ratePaise, line.salePricePaise]).toEqual([37_62, 66_00]);
  });
});
