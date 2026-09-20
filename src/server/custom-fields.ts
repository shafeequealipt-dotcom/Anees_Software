import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { customFields } from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import { MasterError } from "./masters";

export type FieldKind = "text" | "number" | "date" | "yesno";

export const customFieldSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter the field name.").max(60),
  kind: z.enum(["text", "number", "date", "yesno"]).default("text"),
  showOnInvoice: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function listCustomFields(db: DB | Tx, firmId: number, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(customFields)
    .where(and(eq(customFields.firmId, firmId), eq(customFields.entity, "item"), opts.activeOnly ? eq(customFields.active, true) : undefined))
    .orderBy(asc(customFields.sort), asc(customFields.id));
}

export async function saveCustomField(db: DB, firmId: number, raw: z.input<typeof customFieldSchema>) {
  const p = customFieldSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, "name");
  const { id, ...values } = p.data;
  const all = await listCustomFields(db, firmId);
  if (all.some((f) => f.id !== id && f.name.toLowerCase() === values.name.toLowerCase())) throw new MasterError("A field with this name already exists.", "name");
  if (id) {
    const cur = all.find((f) => f.id === id);
    if (!cur) throw new MasterError("This field no longer exists.");
    await db.update(customFields).set({ name: values.name, showOnInvoice: values.showOnInvoice, active: values.active }).where(eq(customFields.id, id));
    return id;
  }
  const [row] = await db.insert(customFields).values({ ...values, firmId, entity: "item", sort: all.length }).returning({ id: customFields.id });
  return row.id;
}

/** Keeps only values for the company's active fields, checked against each field's type. Blank values are dropped. */
export async function cleanCustomValues(db: DB | Tx, firmId: number, values: Record<string, string> | null | undefined): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!values) return out;
  const fields = await listCustomFields(db, firmId, { activeOnly: true });
  for (const f of fields) {
    const raw = (values[String(f.id)] ?? "").trim();
    if (!raw) continue;
    if (f.kind === "number" && !Number.isFinite(Number(raw.replace(/,/g, "")))) throw new MasterError(`${f.name}: "${raw}" is not a number.`);
    if (f.kind === "date" && !isIsoDate(raw)) throw new MasterError(`${f.name}: enter a valid date.`);
    out[String(f.id)] = f.kind === "yesno" ? (/^(y|yes|true|1)$/i.test(raw) ? "yes" : "no") : f.kind === "number" ? String(Number(raw.replace(/,/g, ""))) : raw.slice(0, 200);
  }
  return out;
}
