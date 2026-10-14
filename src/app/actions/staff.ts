"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { MasterError } from "@/server/errors";
import { can } from "@/lib/permissions";
import { type adjustmentSchema, deleteEmployee, type employeeSchema, type paySchema, payEmployee, saveEmployee, saveSalaryAdjustment } from "@/server/staff";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

export async function saveEmployeeAction(input: z.input<typeof employeeSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("staff.manage");
    const id = await saveEmployee(await getDb(), user.firmId, input, user.id);
    revalidatePath("/staff", "layout");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSalaryAdjustmentAction(input: z.input<typeof adjustmentSchema>): Promise<Result> {
  try {
    const user = await assertUser("staff.manage");
    await saveSalaryAdjustment(await getDb(), user.firmId, input, user.id);
    revalidatePath("/staff", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function payEmployeeAction(input: z.input<typeof paySchema>): Promise<Result<{ id: number; number: string }>> {
  try {
    const user = await assertUser("staff.manage");
    const r = await payEmployee(await getDb(), user.firmId, input, user.id);
    revalidatePath("/staff", "layout");
    revalidatePath("/expenses");
    return { ok: true, id: r.id, number: r.number };
  } catch (e) {
    return fail(e);
  }
}

/** Owners and Company owners only ("Delete staff and partners"). Someone with payments is made inactive instead. */
export async function deleteEmployeeAction(id: number): Promise<Result<{ outcome: "deleted" | "deactivated" }>> {
  try {
    const user = await assertUser("staff.manage");
    if (!can(user, "people.delete")) throw new AuthError("Only an owner can delete staff.");
    const outcome = await deleteEmployee(await getDb(), user.firmId, id, user.id);
    revalidatePath("/staff", "layout");
    return { ok: true, outcome };
  } catch (e) {
    return fail(e);
  }
}
