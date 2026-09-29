import { getDb } from "@/db";
import { can } from "@/lib/permissions";
import { apiUser } from "@/server/api";
import { audit } from "@/lib/audit";
import { todayIST } from "@/lib/dates";
import { xlsxResponse } from "@/server/excel";
import { backupFirmIds, exportAllData, inspectBackup, restoreAllData } from "@/server/data-backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024;

/** ?company=<id> backs up one company; no parameter (or ?company=all) backs up every company this person may open. */
export async function GET(req: Request) {
  const a = await apiUser("backups.manage");
  if (a.res) return a.res;
  const db = await getDb();
  const allowed = await backupFirmIds(db, a.user);
  const pick = new URL(req.url).searchParams.get("company");
  let firmIds = allowed;
  if (pick && pick !== "all") {
    const id = Number(pick);
    if (!allowed.includes(id)) return new Response("You don't have access to that company.", { status: 403 });
    firmIds = [id];
  }
  const { buffer, companies, rows } = await exportAllData(db, firmIds, a.user);
  const which = companies.length === 1 ? `"${companies[0]}"` : `${companies.length} companies`;
  await audit(db, { firmId: a.user.firmId, userId: a.user.id, action: "export", entity: "backup", summary: `Downloaded an Excel backup of ${which} (${rows} rows)` });
  const stamp = todayIST();
  const slug = companies.length === 1 ? companies[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "company" : "all-companies";
  return xlsxResponse(buffer, `backup-${slug}-${stamp}.xlsx`);
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
