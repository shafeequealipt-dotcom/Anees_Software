import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { firms } from "@/db/schema";
import { saleRateFor } from "@/lib/pricing";
import { saveItem, saveParty } from "@/server/masters";
import { createCompany } from "@/server/admin";
import { getItemPrices, getPartyRates, loadPricing, savePriceList, setItemPrices, setPartyRates } from "@/server/pricing";
import { runFirstSetup } from "@/server/setup";
import { testDb } from "./helpers/db";

const item = { id: 1, salePricePaise: 10_000, saleIncl: false };

describe("which price applies", () => {
  const pricing = {
    lists: { 7: { 1: { paise: 8_000, incl: true } } },
    parties: { 1: { 1: { ratePaise: 6_500, discountBp: null } }, 2: { 1: { ratePaise: null, discountBp: 1000 } } },
  };
  it("uses the normal price when nothing else applies", () => {
    expect(saleRateFor(item, null, pricing)).toEqual({ paise: 10_000, incl: false, source: "item" });
    expect(saleRateFor(item, { id: 9, priceListId: null }, pricing).source).toBe("item");
  });
  it("uses the party's price list, falling back to the normal price when the list has none", () => {
    expect(saleRateFor(item, { id: 9, priceListId: 7 }, pricing)).toEqual({ paise: 8_000, incl: true, source: "list" });
    expect(saleRateFor({ ...item, id: 2 }, { id: 9, priceListId: 7 }, pricing).paise).toBe(10_000);
  });
  it("a special rate beats the list, and a percentage off is taken from the list price", () => {
    expect(saleRateFor(item, { id: 1, priceListId: 7 }, pricing)).toMatchObject({ paise: 6_500, source: "party" });
    expect(saleRateFor(item, { id: 2, priceListId: 7 }, pricing)).toMatchObject({ paise: 7_200, source: "party" });
    expect(saleRateFor(item, { id: 2, priceListId: null }, pricing).paise).toBe(9_000);
  });
});

describe("price list data", () => {
  let db: DB;
  let firmId: number;
  let other: number;
  let itemId: number;
  let partyId: number;
  let retail: number;
  let wholesale: number;
  beforeAll(async () => {
    db = await testDb();
    await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
    [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
    other = await createCompany(db, { name: "Other Co", country: "IN" }, 1);
    itemId = await saveItem(db, firmId, { name: "Rice", salePricePaise: 5_000 }, 1);
    partyId = await saveParty(db, firmId, { name: "Ravi", kind: "customer" }, 1);
    retail = await savePriceList(db, firmId, { name: "Retail" });
    wholesale = await savePriceList(db, firmId, { name: "Wholesale" });
  });

  it("keeps list names unique per company", async () => {
    await expect(savePriceList(db, firmId, { name: "retail" })).rejects.toThrow(/already exists/);
    await expect(savePriceList(db, other, { name: "Retail" })).resolves.toBeTruthy();
  });

  it("sets, reads and removes an item's price on each list", async () => {
    await setItemPrices(db, firmId, itemId, [{ priceListId: retail, salePricePaise: 5_500, includesTax: false }, { priceListId: wholesale, salePricePaise: 4_500, includesTax: true }], 1);
    let rows = await getItemPrices(db, firmId, itemId);
    expect(rows.map((r) => [r.name, r.salePricePaise])).toEqual([["Retail", 5_500], ["Wholesale", 4_500]]);
    await setItemPrices(db, firmId, itemId, [{ priceListId: retail, salePricePaise: null, includesTax: false }], 1);
    rows = await getItemPrices(db, firmId, itemId);
    expect(rows.find((r) => r.name === "Retail")!.salePricePaise).toBeNull();
    const pricing = await loadPricing(db, firmId);
    expect(pricing.lists[wholesale][itemId]).toEqual({ paise: 4_500, incl: true });
  });

  it("stores a party's special rates and replaces them wholesale", async () => {
    await setPartyRates(db, firmId, partyId, [{ itemId, ratePaise: 4_000, discountBp: null }], 1);
    expect((await getPartyRates(db, firmId, partyId))[0]).toMatchObject({ itemName: "Rice", ratePaise: 4_000 });
    await setPartyRates(db, firmId, partyId, [{ itemId, ratePaise: null, discountBp: 500 }], 1);
    expect((await loadPricing(db, firmId)).parties[partyId][itemId]).toEqual({ ratePaise: null, discountBp: 500 });
    await setPartyRates(db, firmId, partyId, [], 1);
    expect(await getPartyRates(db, firmId, partyId)).toEqual([]);
  });

  it("refuses another company's item, party or list", async () => {
    await expect(setItemPrices(db, other, itemId, [], 1)).rejects.toThrow(/no longer exists/);
    await expect(setItemPrices(db, firmId, itemId, [{ priceListId: 99999, salePricePaise: 1, includesTax: false }], 1)).rejects.toThrow(/this company/);
    await expect(setPartyRates(db, other, partyId, [], 1)).rejects.toThrow(/no longer exists/);
    await expect(saveParty(db, firmId, { name: "X", priceListId: 99999 }, 1)).rejects.toThrow(/this company/);
  });
});
