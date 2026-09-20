import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { itemPrices, items, parties, partyRates, priceLists } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Pricing } from "@/lib/pricing";
import { MasterError } from "./masters";

export const priceListSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter a name for the price list.").max(80),
  active: z.boolean().default(true),
});

export async function listPriceLists(db: DB, firmId: number) {
  return db.select().from(priceLists).where(eq(priceLists.firmId, firmId)).orderBy(asc(priceLists.name));
}

export async function savePriceList(db: DB, firmId: number, raw: z.input<typeof priceListSchema>) {
  const p = priceListSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, "name");
  const { id, ...values } = p.data;
  const clash = (await listPriceLists(db, firmId)).find((l) => l.name.toLowerCase() === values.name.toLowerCase() && l.id !== id);
  if (clash) throw new MasterError("A price list with this name already exists.", "name");
  if (id) {
    const [own] = await db.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.firmId, firmId)));
    if (!own) throw new MasterError("This price list no longer exists.");
    await db.update(priceLists).set(values).where(eq(priceLists.id, id));
    return id;
  }
  const [row] = await db.insert(priceLists).values({ ...values, firmId }).returning({ id: priceLists.id });
  return row.id;
}

async function ownItem(db: DB, firmId: number, itemId: number) {
  const [i] = await db.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.id, itemId), eq(items.firmId, firmId)));
  if (!i) throw new MasterError("This item no longer exists.");
  return i;
}

export async function getItemPrices(db: DB, firmId: number, itemId: number) {
  await ownItem(db, firmId, itemId);
  const lists = await listPriceLists(db, firmId);
  const rows = await db.select().from(itemPrices).where(eq(itemPrices.itemId, itemId));
  return lists.map((l) => {
    const r = rows.find((x) => x.priceListId === l.id);
    return { priceListId: l.id, name: l.name, active: l.active, salePricePaise: r?.salePricePaise ?? null, includesTax: r?.includesTax ?? false };
  });
}

/** Sets the item's price on each list. A null price removes it, so the item's normal price applies. */
export async function setItemPrices(db: DB, firmId: number, itemId: number, prices: { priceListId: number; salePricePaise: number | null; includesTax: boolean }[], userId: number) {
  const item = await ownItem(db, firmId, itemId);
  const own = new Set((await listPriceLists(db, firmId)).map((l) => l.id));
  await db.transaction(async (tx) => {
    for (const p of prices) {
      if (!own.has(p.priceListId)) throw new MasterError("Choose a price list from this company.");
      if (p.salePricePaise === null) {
        await tx.delete(itemPrices).where(and(eq(itemPrices.priceListId, p.priceListId), eq(itemPrices.itemId, itemId)));
        continue;
      }
      if (!Number.isInteger(p.salePricePaise) || p.salePricePaise < 0) throw new MasterError("Prices must be zero or more.");
      await tx
        .insert(itemPrices)
        .values({ priceListId: p.priceListId, itemId, salePricePaise: p.salePricePaise, includesTax: p.includesTax })
        .onConflictDoUpdate({ target: [itemPrices.priceListId, itemPrices.itemId], set: { salePricePaise: p.salePricePaise, includesTax: p.includesTax } });
    }
    await audit(tx, { firmId, userId, action: "update", entity: "item", entityId: itemId, summary: `Changed price-list prices of ${item.name}` });
  });
}

export async function getPartyRates(db: DB, firmId: number, partyId: number) {
  const [p] = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.id, partyId), eq(parties.firmId, firmId)));
  if (!p) throw new MasterError("This party no longer exists.");
  return db
    .select({ itemId: partyRates.itemId, itemName: items.name, ratePaise: partyRates.ratePaise, discountBp: partyRates.discountBp, salePricePaise: items.salePricePaise })
    .from(partyRates)
    .innerJoin(items, eq(items.id, partyRates.itemId))
    .where(eq(partyRates.partyId, partyId))
    .orderBy(asc(items.name));
}

export const partyRatesSchema = z.array(
  z.object({
    itemId: z.number().int().positive(),
    ratePaise: z.number().int().min(0).nullable(),
    discountBp: z.number().int().min(0).max(10000).nullable(),
  }),
);

/** Replaces all of a party's special rates. */
export async function setPartyRates(db: DB, firmId: number, partyId: number, raw: z.input<typeof partyRatesSchema>, userId: number) {
  const p = partyRatesSchema.safeParse(raw);
  if (!p.success) throw new MasterError("Check the rates: each needs a price or a percentage off.");
  const [party] = await db.select({ id: parties.id, name: parties.name }).from(parties).where(and(eq(parties.id, partyId), eq(parties.firmId, firmId)));
  if (!party) throw new MasterError("This party no longer exists.");
  const rows = p.data.filter((r) => r.ratePaise !== null || r.discountBp !== null);
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  if (itemIds.length) {
    const own = await db.select({ id: items.id }).from(items).where(and(eq(items.firmId, firmId), inArray(items.id, itemIds)));
    if (own.length !== itemIds.length) throw new MasterError("One of the items no longer exists.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(partyRates).where(eq(partyRates.partyId, partyId));
    const seen = new Set<number>();
    const unique = rows.filter((r) => (seen.has(r.itemId) ? false : (seen.add(r.itemId), true)));
    if (unique.length) await tx.insert(partyRates).values(unique.map((r) => ({ partyId, ...r })));
    await audit(tx, { firmId, userId, action: "update", entity: "party", entityId: partyId, summary: `Changed special rates for ${party.name} (${unique.length} items)` });
  });
}

/** Everything the bill form needs to pick the right selling price. */
export async function loadPricing(db: DB, firmId: number): Promise<Pricing> {
  const lists = await listPriceLists(db, firmId);
  const out: Pricing = { lists: {}, parties: {} };
  if (lists.length) {
    const rows = await db.select().from(itemPrices).where(inArray(itemPrices.priceListId, lists.map((l) => l.id)));
    for (const r of rows) (out.lists[r.priceListId] ??= {})[r.itemId] = { paise: r.salePricePaise, incl: r.includesTax };
  }
  const special = await db
    .select({ partyId: partyRates.partyId, itemId: partyRates.itemId, ratePaise: partyRates.ratePaise, discountBp: partyRates.discountBp })
    .from(partyRates)
    .innerJoin(parties, eq(parties.id, partyRates.partyId))
    .where(eq(parties.firmId, firmId));
  for (const r of special) (out.parties[r.partyId] ??= {})[r.itemId] = { ratePaise: r.ratePaise, discountBp: r.discountBp };
  return out;
}
