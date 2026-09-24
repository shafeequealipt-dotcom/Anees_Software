import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms } from "@/db/schema";
import { nowTimeInZone, todayIST } from "@/lib/dates";
import { getSettings, saveSettings } from "@/lib/settings";
import { setRegion } from "@/lib/region";
import { loadDailyReportModel } from "../daily-report";
import { renderDailyReportPdf } from "../pdf/daily-report-pdf";
import { dailySalesReport } from "../reports";
import { channelStatus, sendEmail } from "./channels";

/**
 * Once a day, at the time the owner chose, emails them the whole company's sales report for that
 * day with the PDF attached. Safe to call often (e.g. every couple of minutes): it only actually
 * sends once the configured time has passed and it hasn't already sent for today. If email isn't
 * set up on this server, it does nothing here — the Home page banner (computed live from these
 * same settings) is what the owner sees and shares from instead.
 */
export async function runDailyReportEmail(db: DB, firmId: number): Promise<{ sent: boolean }> {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return { sent: false };
  setRegion(firm.country);
  const cfg = await getSettings(db, firmId);
  if (!cfg.dailyReportEnabled) return { sent: false };
  if (!cfg.notifyOwnerEmail || !channelStatus().email) return { sent: false };
  const today = todayIST();
  if (cfg.dailyReportLastSentDate === today) return { sent: false };
  if (nowTimeInZone() < cfg.dailyReportTime) return { sent: false };

  const [model, raw] = await Promise.all([loadDailyReportModel(db, firmId, today, undefined, { paper: "A4" }), dailySalesReport(db, firmId, today)]);
  if (!model) return { sent: false };
  const pdf = await renderDailyReportPdf(model);
  const r = await sendEmail(
    cfg.notifyOwnerEmail,
    `${model.title} — ${firm.name} — ${model.dateLabel}`,
    `Attached: today's sales report for ${firm.name}.\n\nBills: ${raw.bills}\nNet sales: ${model.currency} ${(raw.netSalesPaise / 100).toFixed(2)}`,
    { filename: model.fileName, content: pdf },
  );
  // Only mark today as done once it actually sent — a transient SMTP failure just retries on the
  // next cron tick rather than silently skipping the whole day.
  if (r.ok) await saveSettings(db, firmId, { dailyReportLastSentDate: today });
  return { sent: r.ok };
}
