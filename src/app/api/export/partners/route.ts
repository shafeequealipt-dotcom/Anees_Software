import { getDb } from "@/db";
import { apiUser } from "@/server/api";
import { toXlsx, xlsxResponse } from "@/server/excel";
import { exportPartnerSheet, partnersEnabled, sheetColumns } from "@/server/partners";
import { monthSchema } from "@/server/staff";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiUser("partners.manage");
  if (a.res) return a.res;
  const db = await getDb();
  if (!(await partnersEnabled(db, a.user.firmId))) return new Response("Not found", { status: 404 });
  const m = monthSchema.safeParse(new URL(req.url).searchParams.get("month"));
  if (!m.success) return new Response("Pick a month.", { status: 400 });
  const rows = await exportPartnerSheet(db, a.user.firmId, m.data);
  const note = "Partner payments for the month: views, the amount for views, promotions, what is payable, and what has been paid and is still due.\nPayment To is where to send the money (from the partner's bank details).";
  return xlsxResponse(await toXlsx(`Partners ${m.data}`, sheetColumns, rows, note), `partners-${m.data}.xlsx`);
}
