import { CustomFieldManager } from "@/components/custom-field-manager";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listCustomFields } from "@/server/custom-fields";

export const metadata = { title: "Item fields" };

export default async function CustomFieldsPage() {
  const user = await requireUser("settings.edit");
  const list = await listCustomFields(await getDb(), user.firmId);
  return <CustomFieldManager fields={list.map((f) => ({ id: f.id, name: f.name, kind: f.kind as "text" | "number" | "date" | "yesno", showOnInvoice: f.showOnInvoice, active: f.active }))} />;
}
