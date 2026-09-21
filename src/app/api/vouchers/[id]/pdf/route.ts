import { getDb } from "@/db";
import { currentUser } from "@/lib/auth";
import { loadInvoiceModel } from "@/server/invoice";
import { renderInvoicePdf } from "@/server/pdf/invoice-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || user.firmId === 0 || user.mustChangePassword) return new Response("Please sign in.", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!id) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const paper = ({ a4: "A4", a5: "A5", t80: "T80", t58: "T58" } as const)[(q.get("paper") ?? "") as "a4"];
  const model = await loadInvoiceModel(await getDb(), user.firmId, id, { paper });
  if (!model) return new Response("Not found", { status: 404 });
  const pdf = await renderInvoicePdf(model);
  const download = q.get("download") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${model.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
