import { getDb } from "@/db";
import { apiUser } from "@/server/api";
import { loadPayoutInvoice, partnersEnabled } from "@/server/partners";
import { renderPayoutInvoicePdf } from "@/server/pdf/payout-invoice-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await apiUser("partners.manage");
  if (a.res) return a.res;
  const id = Number((await ctx.params).id);
  const db = await getDb();
  if (!id || !(await partnersEnabled(db, a.user.firmId))) return new Response("Not found", { status: 404 });
  const inv = await loadPayoutInvoice(db, a.user.firmId, id);
  if (!inv) return new Response("Not found", { status: 404 });
  const pdf = await renderPayoutInvoicePdf(inv.model);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName(inv.model.invoiceNo, inv.model.payee.name)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "invoice";
const fileName = (no: string, payee: string) => `Invoice_${slug(no)}_${slug(payee)}.pdf`;
