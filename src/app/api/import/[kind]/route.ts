import { getDb } from "@/db";
import { can } from "@/lib/permissions";
import { apiUser } from "@/server/api";
import { readTable } from "@/server/excel";
import { importItems, importParties } from "@/server/imports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const a = await apiUser("masters.edit");
  if (a.res) return a.res;
  const kind = (await ctx.params).kind;
  if (kind !== "parties" && kind !== "items") return Response.json({ error: "Unknown import." }, { status: 404 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file first." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "The file is too big (limit 5 MB)." }, { status: 400 });
  if (!/\.(xlsx|csv)$/i.test(file.name)) return Response.json({ error: "Use an Excel (.xlsx) or CSV file." }, { status: 400 });
  const dryRun = form.get("mode") !== "import";
  try {
    const table = await readTable(Buffer.from(await file.arrayBuffer()), file.name);
    if (table.rows.length === 0) return Response.json({ error: "The file has no rows below the headings." }, { status: 400 });
    const db = await getDb();
    const result =
      kind === "parties"
        ? await importParties(db, a.user.firmId, table, a.user.id, dryRun)
        : await importItems(db, a.user.firmId, table, a.user.id, { dryRun, purchase: can(a.user, "see.purchasePrice") });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "The file couldn't be read." }, { status: 400 });
  }
}
