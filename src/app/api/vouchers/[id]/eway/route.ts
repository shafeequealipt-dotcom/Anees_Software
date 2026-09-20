import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { firms, parties } from "@/db/schema";
import { buildEwayBill } from "@/lib/eway";
import { voucherNumber } from "@/lib/voucher-types";
import { apiUser } from "@/server/api";
import { getVoucher } from "@/server/vouchers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await apiUser("reports.sales");
  if (a.res) return a.res;
  const db = await getDb();
  const data = await getVoucher(db, a.user.firmId, Number((await ctx.params).id) || 0);
  if (!data || data.voucher.type !== "sale_invoice" || data.voucher.status !== "active") return new Response("Not found", { status: 404 });
  const [firm] = await db.select().from(firms).where(eq(firms.id, a.user.firmId));
  if (!firm || firm.country !== "IN") return new Response("E-way bills are for Indian GST businesses.", { status: 400 });
  const v = data.voucher;
  const [party] = v.partyId ? await db.select().from(parties).where(and(eq(parties.id, v.partyId), eq(parties.firmId, a.user.firmId))) : [];
  const intra = v.igstPaise === 0;
  const r = buildEwayBill({
    firm: { gstin: firm.gstin ?? "", name: firm.legalName || firm.name, address: firm.address, city: firm.city, pincode: firm.pincode, stateCode: firm.stateCode },
    bill: {
      number: voucherNumber(v),
      date: v.date,
      partyGstin: v.partyGstin,
      partyName: v.partyName,
      billingAddress: v.billingAddress,
      shippingAddress: v.shippingAddress,
      placeOfSupply: v.placeOfSupply,
      partyStateCode: party?.stateCode ?? null,
      taxablePaise: v.taxablePaise,
      cgstPaise: v.cgstPaise,
      sgstPaise: v.sgstPaise,
      igstPaise: v.igstPaise,
      cessPaise: v.cessPaise,
      totalPaise: v.totalPaise,
      vehicleNo: v.vehicleNo,
      transportName: v.transportName,
      otherValuePaise: v.roundOffPaise + v.tcsPaise,
    },
    lines: data.lines.map((l) => ({ description: l.description, hsn: l.hsn, qtyMilli: l.qtyMilli * (l.unitFactorMilli / 1000), unitCode: l.unitFactorMilli === 1000 ? l.unitCode : null, taxablePaise: l.taxablePaise, gstBp: l.gstBp, cessBp: l.cessBp, intra })),
  });
  if (!r.ok) return Response.json({ problems: r.problems }, { status: 422 });
  return new Response(JSON.stringify(r.json, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="eway-${voucherNumber(v).replace(/[^A-Za-z0-9]+/g, "-")}.json"`, "Cache-Control": "private, no-store" },
  });
}
