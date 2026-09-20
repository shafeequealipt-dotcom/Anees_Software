"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { eq } from "drizzle-orm";
import { items, parties } from "@/db/schema";
import { AuthError, assertUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  accountSchema,
  deleteItem,
  deleteParty,
  MasterError,
  saveAccount,
  saveCategory,
  saveItem,
  saveLedgerCategory,
  saveParty,
  savePartyGroup,
  saveTaxRate,
  saveUnit,
  type itemSchema,
  type partySchema,
  type taxRateSchema,
  type unitSchema,
} from "@/server/masters";
import type { z } from "zod";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
}

export async function savePartyAction(input: z.input<typeof partySchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("masters.edit");
    const db = await getDb();
    let data = input;
    if (input.id) {
      const [old] = await db.select().from(parties).where(eq(parties.id, input.id));
      if (old) {
        if (!can(user, "see.partyContact")) {
          data = { ...data, phone: old.phone, email: old.email, gstin: old.gstin, pan: old.pan, stateCode: old.stateCode, billingAddress: old.billingAddress, shippingAddress: old.shippingAddress };
        }
        if (!can(user, "see.partyBalance")) {
          data = { ...data, openingBalancePaise: old.openingBalancePaise, openingDate: old.openingDate, creditLimitPaise: old.creditLimitPaise };
        }
      }
    }
    const id = await saveParty(db, data, user.id);
    revalidatePath("/parties");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePartyAction(id: number): Promise<Result<{ outcome: "deleted" | "deactivated" | undefined }>> {
  try {
    const user = await assertUser("masters.delete");
    const outcome = await deleteParty(await getDb(), id, user.id);
    revalidatePath("/parties");
    return { ok: true, outcome };
  } catch (e) {
    return fail(e);
  }
}

export async function savePartyGroupAction(name: string): Promise<Result<{ id: number }>> {
  try {
    await assertUser("masters.edit");
    return { ok: true, id: await savePartyGroup(await getDb(), name) };
  } catch (e) {
    return fail(e);
  }
}

export async function saveItemAction(input: z.input<typeof itemSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("masters.edit");
    const db = await getDb();
    let data = input;
    if (input.id && !can(user, "see.purchasePrice")) {
      const [old] = await db.select().from(items).where(eq(items.id, input.id));
      if (old) data = { ...data, purchasePricePaise: old.purchasePricePaise, purchasePriceIncludesTax: old.purchasePriceIncludesTax, openingRatePaise: old.openingRatePaise };
    }
    const id = await saveItem(db, data, user.id);
    revalidatePath("/items");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteItemAction(id: number): Promise<Result<{ outcome: "deleted" | "deactivated" | undefined }>> {
  try {
    const user = await assertUser("masters.delete");
    const outcome = await deleteItem(await getDb(), id, user.id);
    revalidatePath("/items");
    return { ok: true, outcome };
  } catch (e) {
    return fail(e);
  }
}

export async function saveCategoryAction(name: string): Promise<Result<{ id: number }>> {
  try {
    await assertUser("masters.edit");
    return { ok: true, id: await saveCategory(await getDb(), name) };
  } catch (e) {
    return fail(e);
  }
}

export async function saveUnitAction(input: z.input<typeof unitSchema>): Promise<Result<{ id: number }>> {
  try {
    await assertUser("masters.edit");
    const id = await saveUnit(await getDb(), input);
    revalidatePath("/settings/units");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTaxRateAction(input: z.input<typeof taxRateSchema>): Promise<Result<{ id: number }>> {
  try {
    await assertUser("settings.edit");
    const id = await saveTaxRate(await getDb(), input);
    revalidatePath("/settings/tax-rates");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAccountAction(input: z.input<typeof accountSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("money.edit");
    const id = await saveAccount(await getDb(), input, user.id);
    revalidatePath("/cash-bank");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveLedgerCategoryAction(kind: "expense" | "income", name: string): Promise<Result<{ id: number }>> {
  try {
    await assertUser("masters.edit");
    const id = await saveLedgerCategory(await getDb(), kind, name);
    revalidatePath("/settings/categories");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}
