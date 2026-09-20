import "server-only";
import { z } from "zod";
import type { DB } from "@/db";
import { audit } from "@/lib/audit";
import { saveSettings } from "@/lib/settings";
import { MasterError } from "../masters";

export const messagingSchema = z.object({
  notifyOwnerPhone: z.string().trim().max(30).default(""),
  notifyOwnerEmail: z.union([z.string().trim().email("Enter a valid email address."), z.literal("")]).default(""),
  notifyOwnerOnNewTransaction: z.boolean().default(false),
  notifyPartyOnChange: z.boolean().default(false),
  paymentReminders: z.boolean().default(false),
  reminderFirstAfterDays: z.number().int().min(0).max(90),
  reminderEveryDays: z.number().int().min(1).max(90),
  reminderMaxCount: z.number().int().min(1).max(20),
  reminderMessage: z.string().trim().min(5, "Write the reminder message.").max(500),
});

export async function saveMessagingSettings(db: DB, firmId: number, raw: z.input<typeof messagingSchema>, userId: number) {
  const p = messagingSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  await saveSettings(db, firmId, p.data);
  await audit(db, { firmId, userId, action: "settings", entity: "messaging", summary: "Changed messaging settings" });
}
