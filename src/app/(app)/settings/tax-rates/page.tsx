import { and, asc, eq } from "drizzle-orm";
import { TaxRateManager } from "@/components/master-lists";
import { getDb } from "@/db";
import { taxRates } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Tax rates" };

export default async function TaxRatesPage() {
  const user = await requireUser("settings.edit");
  const list = await (await getDb()).select().from(taxRates).where(eq(taxRates.firmId, user.firmId)).orderBy(asc(taxRates.sort), asc(taxRates.id));
  return <TaxRateManager rates={list.map((r) => ({ id: r.id, name: r.name, gstBp: r.gstBp, nature: r.nature as "taxable" | "exempt" | "nil" | "non_gst", active: r.active }))} />;
}
