import { getDb } from "@/db";
import { can } from "@/lib/permissions";
import { apiUser } from "@/server/api";
import { toXlsx, xlsxResponse } from "@/server/excel";
import { listCustomFields } from "@/server/custom-fields";
import { exportItems, itemColumns, itemTemplateRow } from "@/server/imports";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiUser();
  if (a.res) return a.res;
  const purchase = can(a.user, "see.purchasePrice");
  const template = new URL(req.url).searchParams.get("template") === "1";
  const db = await getDb();
  const custom = await listCustomFields(db, a.user.firmId, { activeOnly: true });
  const rows = template ? [itemTemplateRow()] : await exportItems(db, a.user.firmId, custom);
  const note = "To update items in bulk: export, change the cells you want, then import the file again.\nRows are matched by ID, then by item code, then by name. Empty cells leave the existing value unchanged.\nRows with a new name are added as new items. Unit and category are created if they don't exist yet. Tax rate must already exist under Settings → Tax rates.\nDelete the example row before importing a template.";
  return xlsxResponse(await toXlsx("Items", itemColumns({ purchase, custom }), rows, note), template ? "items-template.xlsx" : "items.xlsx");
}
