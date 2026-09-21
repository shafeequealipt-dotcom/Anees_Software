import "server-only";
import { eq } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { zatcaInvoices } from "@/db/schema";

/** An invoice that has been signed and chained for ZATCA can't be edited, cancelled or deleted: issue a credit note instead. */
export async function isZatcaIssued(db: DB | Tx, voucherId: number): Promise<boolean> {
  const [r] = await db.select({ id: zatcaInvoices.id }).from(zatcaInvoices).where(eq(zatcaInvoices.voucherId, voucherId)).limit(1);
  return !!r;
}

export const ZATCA_LOCKED_MESSAGE = "This invoice has been issued to ZATCA and can't be changed. Issue a credit note (sale return) to correct it.";
