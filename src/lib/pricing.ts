/** Which selling price applies to an item for a party. Pure so the bill form and the tests use the same rule. */
export interface Pricing {
  /** price list id → item id → price */
  lists: Record<number, Record<number, { paise: number; incl: boolean }>>;
  /** party id → item id → special rate or percentage off */
  parties: Record<number, Record<number, { ratePaise: number | null; discountBp: number | null }>>;
}

export const emptyPricing: Pricing = { lists: {}, parties: {} };

export type PriceSource = "party" | "list" | "item";

/**
 * 1. A special rate for this party and item wins.
 * 2. Otherwise the party's price list price, or the item's normal price when the list has none.
 * 3. A percentage off set for the party is taken off whichever of 2 applies.
 */
export function saleRateFor(
  item: { id: number; salePricePaise: number; saleIncl: boolean },
  party: { id: number; priceListId: number | null } | null,
  pricing: Pricing,
): { paise: number; incl: boolean; source: PriceSource } {
  const special = party ? pricing.parties[party.id]?.[item.id] : undefined;
  if (special?.ratePaise != null) return { paise: special.ratePaise, incl: item.saleIncl, source: "party" };
  const listed = party?.priceListId ? pricing.lists[party.priceListId]?.[item.id] : undefined;
  let paise = listed ? listed.paise : item.salePricePaise;
  const incl = listed ? listed.incl : item.saleIncl;
  let source: PriceSource = listed ? "list" : "item";
  if (special?.discountBp) {
    paise = Math.round((paise * (10000 - special.discountBp)) / 10000);
    source = "party";
  }
  return { paise, incl, source };
}
