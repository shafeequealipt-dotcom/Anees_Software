import { getDb } from "@/db";
import { can } from "@/lib/permissions";
import { apiUser } from "@/server/api";
import { audit } from "@/lib/audit";
import { xlsxResponse } from "@/server/excel";
import { backupFirmIds, exportAllData, inspectBackup, restoreAllData } from "@/server/data-backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024;

export async function GET() {
  const a = await apiUser("backups.manage");
  if (a.res) return a.res;
  const db = await getDb();
  const firmIds = await backupFirmIds(db, a.user);
  const { buffer, companies, rows } = await exportAllData(db, firmIds, a.user);
  await audit(db, { firmId: a.user.firmId, userId: a.user.id, action: "export", entity: "backup", summary: `Downloaded a full Excel backup (${companies.length} ${companies.length === 1 ? "company" : "companies"}, ${rows} rows)` });
  const stamp = new Date().toISOString().slice(0, 10);
  return xlsxResponse(buffer, `billing-backup-${stamp}.xlsx`);
}

async function readUpload(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw Object.assign(new Error("Choose a file first."), { status: 400 });
  if (file.size > MAX_BYTES) throw Object.assign(new Error("The file is too big (limit 50 MB)."), { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) throw Object.assign(new Error("Use the .xlsx file downloaded from this page."), { status: 400 });
  return Buffer.from(await file.arrayBuffer());
}

/** ?mode=check inspects the file without writing anything; ?mode=restore adds it as new companies. */
export async function POST(req: Request) {
  const a = await apiUser("backups.manage");
  if (a.res) return a.res;
  const mode = new URL(req.url).searchParams.get("mode") === "restore" ? "restore" : "check";
  if (mode === "restore" && !can(a.user, "companies.manage")) return new Response("Your role can't add companies.", { status: 403 });

  try {
    const buf = await readUpload(req);
    const db = await getDb();
    if (mode === "check") {
      const { companies, rows } = await inspectBackup(buf);
      return Response.json({ ok: true, companies, rows });
    }
    const ip = req.headers.get("x-forwarded-for");
    const result = await restoreAllData(db, buf, a.user, ip);
    return Response.json({ ok: true, companies: result.companies.map((c) => c.name), rows: Object.values(result.rows).reduce((a2, n) => a2 + n, 0) });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "The file couldn't be read." }, { status });
  }
}
