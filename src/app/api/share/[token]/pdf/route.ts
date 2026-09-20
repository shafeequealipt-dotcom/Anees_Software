import { getDb } from "@/db";
import { loadInvoiceModel } from "@/server/invoice";
import { renderInvoicePdf } from "@/server/pdf/invoice-pdf";
import { resolveShare } from "@/server/share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const db = await getDb();
  const link = await resolveShare(db, (await ctx.params).token);
  if (!link) return new Response("This link has expired or is not valid.", { status: 404 });
  const model = await loadInvoiceModel(db, link.firmId, link.voucherId);
  if (!model) return new Response("Not found", { status: 404 });
  const pdf = await renderInvoicePdf(model);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${model.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
