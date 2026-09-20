"use server";

import { getDb } from "@/db";
import { assertUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { globalSearch } from "@/server/reports";

export async function searchAction(q: string) {
  const user = await assertUser();
  const db = await getDb();
  const r = await globalSearch(db, q.slice(0, 100), { partyContact: can(user, "see.partyContact") });
  return {
    parties: r.parties,
    items: r.items,
    vouchers: r.vouchers.map((v) => ({ ...v, label: VOUCHER_INFO[v.type].label, href: `${VOUCHER_INFO[v.type].path}/${v.id}` })),
  };
}
