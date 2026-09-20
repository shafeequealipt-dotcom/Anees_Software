import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { parties } from "@/db/schema";
import { formatDate, isIsoDate } from "@/lib/dates";
import { apiUser } from "@/server/api";
import { toXlsx, xlsxResponse } from "@/server/excel";
import { partyStatement } from "@/server/reports";
import { VOUCHER_INFO } from "@/lib/voucher-types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiUser("see.partyBalance");
  if (a.res) return a.res;
  const q = new URL(req.url).searchParams;
  const db = await getDb();
  const [p] = await db.select().from(parties).where(and(eq(parties.id, Number(q.get("party")) || 0), eq(parties.firmId, a.user.firmId)));
  if (!p) return new Response("Not found", { status: 404 });
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return new Response("Bad dates", { status: 400 });
  const st = await partyStatement(db, p.id, from, to);
  const rows = [
    { date: formatDate(from), entry: "Opening balance", debit: null, credit: null, balance: st.openingPaise / 100 },
    ...st.entries.map((e) => ({
      date: formatDate(e.date),
      entry: e.type ? `${VOUCHER_INFO[e.type].label} ${e.prefix ?? ""}${e.number ?? ""}${e.memo ? ` – ${e.memo}` : ""}` : (e.memo ?? "Opening balance"),
      debit: e.debit_paise ? e.debit_paise / 100 : null,
      credit: e.credit_paise ? e.credit_paise / 100 : null,
      balance: e.balance_paise / 100,
    })),
    { date: formatDate(to), entry: "Closing balance", debit: st.totalDebitPaise / 100, credit: st.totalCreditPaise / 100, balance: st.closingPaise / 100 },
  ];
  const buf = await toXlsx(
    "Statement",
    [
      { header: "Date", key: "date" },
      { header: "Entry", key: "entry", width: 44 },
      { header: "Debit (they owe)", key: "debit", kind: "money", width: 16 },
      { header: "Credit (paid / we owe)", key: "credit", kind: "money", width: 20 },
      { header: "Balance", key: "balance", kind: "money" },
    ],
    rows,
    "Positive balance = they owe you. Negative = you owe them.",
  );
  return xlsxResponse(buf, `statement-${p.name}-${from}-to-${to}.xlsx`);
}
