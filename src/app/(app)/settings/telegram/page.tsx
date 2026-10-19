import { redirect } from "next/navigation";
import { TelegramSettings } from "@/components/telegram-settings";
import { getDb } from "@/db";
import { vouchers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { listCompanies } from "@/server/admin";
import { listTelegramLinks, recentTelegramDrafts, telegramStatus } from "@/server/telegram/config";
import type { ReadBill } from "@/server/telegram/read-bill";
import { inArray } from "drizzle-orm";

export const metadata = { title: "Telegram" };

export default async function TelegramPage() {
  const me = await requireUser("companies.manage");
  if (!me.isOwner) redirect("/settings");
  const db = await getDb();
  const all = (await listCompanies(db, me)).filter((c) => c.active);
  const companies = await Promise.all(all.map(async (c) => ({ id: c.id, name: c.name, on: (await getSettings(db, c.id)).telegramEnabled })));
  const [status, links, drafts] = await Promise.all([telegramStatus(db), listTelegramLinks(db), recentTelegramDrafts(db)]);
  const ids = drafts.map((d) => d.voucherId).filter((x): x is number => !!x);
  const vs = ids.length ? await db.select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number }).from(vouchers).where(inArray(vouchers.id, ids)) : [];
  return (
    <TelegramSettings
      status={status}
      companies={companies}
      httpsOk={(process.env.APP_URL ?? "").startsWith("https://")}
      links={links.map((l) => ({ ...l, createdAt: formatDate(l.createdAt.toISOString().slice(0, 10)) }))}
      drafts={drafts.map((d) => {
        const r = d.extracted as ReadBill | null;
        const v = vs.find((x) => x.id === d.voucherId);
        const what = v
          ? `${VOUCHER_INFO[v.type].label} ${voucherNumber(v)}${r?.supplier?.name ? ` · ${r.supplier.name}` : ""}`
          : r
            ? [r.type === "expense" ? "Expense" : r.type === "purchase_bill" ? "Purchase bill" : "Not a bill", r.supplier?.name, r.billNo].filter(Boolean).join(" · ")
            : "—";
        return { id: d.id, firmName: d.firmName, when: formatDateTime(d.createdAt), what, status: d.status, link: v ? `${VOUCHER_INFO[v.type].path}/${v.id}` : null, error: d.status === "failed" ? d.error : null };
      })}
    />
  );
}
