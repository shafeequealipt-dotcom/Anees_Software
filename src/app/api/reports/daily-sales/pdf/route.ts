import { getDb } from "@/db";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadDailyReportModel, type ReportPaper } from "@/server/daily-report";
import { renderDailyReportPdf } from "@/server/pdf/daily-report-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.firmId === 0 || user.mustChangePassword) return new Response("Please sign in.", { status: 401 });
  if (!can(user, "reports.all")) return new Response("Your role can't do this.", { status: 403 });
  const q = new URL(req.url).searchParams;
  const date = q.get("date");
  if (!date) return new Response("Choose a date.", { status: 400 });
  const rawLocation = q.get("location");
  let locationId: number | undefined = rawLocation ? Number(rawLocation) || undefined : undefined;
  if (!user.allLocations) {
    if (locationId && !user.locations.some((l) => l.id === locationId)) return new Response("You don't have access to that shop.", { status: 403 });
    // No shop chosen and restricted to one: report on that one instead of the whole company.
    if (!locationId && user.locations.length === 1) locationId = user.locations[0].id;
  }
  const paper = ({ a4: "A4", t80: "T80", t58: "T58" } as const)[(q.get("paper") ?? "") as "a4"] as ReportPaper | undefined;
  const model = await loadDailyReportModel(await getDb(), user.firmId, date, locationId, { paper });
  if (!model) return new Response("Not found", { status: 404 });
  const pdf = await renderDailyReportPdf(model);
  const download = q.get("download") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${model.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
