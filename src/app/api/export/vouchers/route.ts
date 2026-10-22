import { getDb } from "@/db";
import { can } from "@/lib/permissions";
import { formatDate, todayIST } from "@/lib/dates";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { apiUser } from "@/server/api";
import { toXlsx, xlsxResponse } from "@/server/excel";
import { listVouchers } from "@/server/reports";
import { sellingOnly, withSellingTotals } from "@/server/transfer-view";
import type { VoucherType } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiUser("reports.sales");
  if (a.res) return a.res;
  const q = new URL(req.url).searchParams;
  const type = (q.get("type") ?? "") as VoucherType;
  if (!VOUCHER_INFO[type]) return new Response("Unknown type", { status: 400 });
  const status = ["open", "paid", "overdue", "cancelled", "all"].includes(q.get("status") ?? "") ? (q.get("status") as "open") : undefined;
  const db = await getDb();
  const loaded = await listVouchers(db, a.user.firmId, {
    types: [type],
    from: q.get("from") || undefined,
    to: q.get("to") || undefined,
    q: q.get("q") || undefined,
    status,
    limit: 20000,
    hideSalaries: !can(a.user, "staff.manage"),
    hidePartners: !can(a.user, "partners.manage"),
    ...(a.user.allLocations ? {} : { locationIds: a.user.locations.map((l) => l.id), createdBy: a.user.id }),
  });
  // Transfers at selling price for people who can't see purchase prices.
  const list = sellingOnly(type, can(a.user, "see.purchasePrice")) ? await withSellingTotals(db, a.user.firmId, loaded) : loaded;
  const info = VOUCHER_INFO[type];
  const rows = list.map((r) => ({
    date: formatDate(r.date),
    number: `${r.prefix}${r.number}`,
    party: r.party_name ?? "",
    supplierNo: r.supplier_invoice_no ?? "",
    taxable: r.taxable_paise / 100,
    tax: r.tax_paise / 100,
    total: r.total_paise / 100,
    paid: r.paid_paise / 100,
    balance: r.balance_paise / 100,
    mode: r.payment_mode ?? "",
    account: r.account_name ?? "",
    category: r.category_name ?? "",
    status: r.status === "cancelled" ? "Cancelled" : "Active",
  }));
  const buf = await toXlsx(
    info.plural,
    [
      { header: "Date", key: "date" },
      { header: "Number", key: "number" },
      { header: "Party", key: "party", width: 28 },
      { header: "Supplier invoice no.", key: "supplierNo", width: 18 },
      { header: "Amount before tax", key: "taxable", kind: "money", width: 16 },
      { header: "Tax", key: "tax", kind: "money" },
      { header: "Total", key: "total", kind: "money" },
      { header: "Paid", key: "paid", kind: "money" },
      { header: "Balance", key: "balance", kind: "money" },
      { header: "Payment mode", key: "mode" },
      { header: "Account", key: "account", width: 18 },
      { header: "Category", key: "category", width: 18 },
      { header: "Status", key: "status" },
    ],
    rows,
  );
  return xlsxResponse(buf, `${info.plural.toLowerCase().replace(/[^a-z]+/g, "-")}-${todayIST()}.xlsx`);
}
