import { getDb } from "@/db";
import { voucherNumber } from "@/lib/voucher-types";
import { apiUser } from "@/server/api";
import { zatcaForVoucher } from "@/server/zatca";
import { getVoucher } from "@/server/vouchers";

export const dynamic = "force-dynamic";

/** The signed e-invoice XML (or ZATCA's cleared copy) for a bill. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await apiUser("reports.sales");
  if (a.res) return a.res;
  const db = await getDb();
  const id = Number((await ctx.params).id) || 0;
  const data = await getVoucher(db, a.user.firmId, id);
  if (!data) return new Response("Not found", { status: 404 });
  const rec = await zatcaForVoucher(db, id);
  if (!rec) return new Response("This bill has not been issued to ZATCA.", { status: 404 });
  return new Response(rec.clearedXml ?? rec.xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${voucherNumber(data.voucher).replace(/[^A-Za-z0-9]+/g, "-")}.xml"`, "Cache-Control": "private, no-store" },
  });
}
