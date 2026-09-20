import { getDb } from "@/db";
import { can } from "@/lib/permissions";
import { apiUser } from "@/server/api";
import { toXlsx, xlsxResponse } from "@/server/excel";
import { exportParties, partyColumns, partyTemplateRow } from "@/server/imports";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiUser();
  if (a.res) return a.res;
  const opts = { contact: can(a.user, "see.partyContact"), balance: can(a.user, "see.partyBalance") };
  const template = new URL(req.url).searchParams.get("template") === "1";
  const rows = template ? [partyTemplateRow()] : await exportParties(await getDb(), a.user.firmId, opts);
  const note = "Fill one party per row. Type: Customer, Supplier or Customer & supplier.\nBalance type: To receive (they owe you) or To pay (you owe them). Existing parties with the same name are skipped.\nDelete the example row before importing.";
  return xlsxResponse(await toXlsx("Parties", partyColumns(opts), rows, note), template ? "parties-template.xlsx" : "parties.xlsx");
}
