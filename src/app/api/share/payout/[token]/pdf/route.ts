import { getDb } from "@/db";
import { loadPayoutInvoice, partnersEnabled, resolvePayoutLink } from "@/server/partners";
import { renderPayoutInvoicePdf } from "@/server/pdf/payout-invoice-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The partner's private link: opens that one invoice's PDF, no sign-in. Unknown, expired or switched-off links all answer "not found". */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const db = await getDb();
  const link = await resolvePayoutLink(db, (await ctx.params).token);
  if (!link || !(await partnersEnabled(db, link.firmId))) return new Response("This link has expired or isn't valid.", { status: 404 });
  const inv = await loadPayoutInvoice(db, link.firmId, link.payoutId);
  if (!inv) return new Response("This link has expired or isn't valid.", { status: 404 });
  const pdf = await renderPayoutInvoicePdf(inv.model);
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "invoice";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice_${slug(inv.model.invoiceNo)}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
