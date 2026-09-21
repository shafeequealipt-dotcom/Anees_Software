"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { MasterError } from "@/server/masters";
import { getProductionCertificate, type profileSchema, runComplianceChecks, saveProfile, setEnabled, startOnboarding, submitInvoice } from "@/server/zatca";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

async function run<T extends object>(fn: (firmId: number, userId: number) => Promise<T>): Promise<Result<T>> {
  try {
    const user = await assertUser("settings.edit");
    if (user.firm.country !== "SA") throw new MasterError("E-invoicing is for companies in Saudi Arabia.");
    const r = await fn(user.firmId, user.id);
    revalidatePath("/settings/einvoicing");
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}

export const saveProfileAction = (input: z.input<typeof profileSchema>) => run(async (f, u) => (await saveProfile(await getDb(), f, input, u), {}));
export const startOnboardingAction = (otp: string) => run(async (f, u) => (await startOnboarding(await getDb(), f, otp, u), {}));
export const runChecksAction = () => run(async (f, u) => ({ results: await runComplianceChecks(await getDb(), f, u) }));
export const getProductionAction = () => run(async (f, u) => (await getProductionCertificate(await getDb(), f, u), {}));
export const setEnabledAction = (on: boolean) => run(async (f, u) => (await setEnabled(await getDb(), f, on, u), {}));
export const retryInvoiceAction = (id: number) => run(async (f) => ({ status: (await submitInvoice(await getDb(), f, id))?.status ?? "" }));
