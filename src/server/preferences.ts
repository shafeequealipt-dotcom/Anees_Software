import "server-only";
import { z } from "zod";
import type { DB } from "@/db";
import { VOUCHER_TYPES } from "@/db/schema";
import { audit } from "@/lib/audit";
import { saveSettings } from "@/lib/settings";
import { MasterError } from "./masters";

export const preferencesSchema = z.object({
  creditLimitMode: z.enum(["off", "warn", "block"]),
  allowNegativeStock: z.boolean(),
  roundOff: z.boolean(),
  lineDiscount: z.boolean(),
  billDiscount: z.boolean(),
  defaultPriceIncludesTax: z.boolean(),
  showMrp: z.boolean(),
  invoiceLanguage: z.enum(["auto", "en", "bilingual", "ar"]),
  printPaperSize: z.enum(["A4", "A5", "thermal"]),
  thermalWidthMm: z.union([z.literal(58), z.literal(80)]),
  invoiceLayout: z.enum(["classic", "modern"]),
  invoiceAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose the colour with the picker."),
  showBankDetailsOnInvoice: z.boolean(),
  showUpiQrOnInvoice: z.boolean(),
  tdsTcsEnabled: z.boolean(),
  quotationTerms: z.string().trim().max(1000),
  prefixes: z.record(z.enum(VOUCHER_TYPES), z.string().trim().max(12, "Prefixes are at most 12 characters.").regex(/^[A-Za-z0-9\-_/]*$/, "Use letters, numbers, - _ or / in a prefix.")),
});

export async function savePreferences(db: DB, firmId: number, raw: z.input<typeof preferencesSchema>, userId: number) {
  const p = preferencesSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  await saveSettings(db, firmId, p.data);
  await audit(db, { firmId, userId, action: "settings", entity: "preferences", summary: "Changed billing preferences" });
}
