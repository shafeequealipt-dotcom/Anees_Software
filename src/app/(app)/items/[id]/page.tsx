import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteMasterButton, PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Badge, LinkButton, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { itemCategories, items, taxRates, units } from "@/db/schema";
import { ItemPricesPanel } from "@/components/pricing-panels";
import { getItemPrices } from "@/server/pricing";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { formatINR, formatPercent, formatQty } from "@/lib/money";
import { can } from "@/lib/permissions";
import { region } from "@/lib/region";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { itemMovements } from "@/server/reports";

export const metadata = { title: "Item" };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const [item] = await db.select().from(items).where(and(eq(items.id, Number(id) || 0), eq(items.firmId, user.firmId)));
  if (!item) notFound();
  const [category] = item.categoryId ? await db.select().from(itemCategories).where(eq(itemCategories.id, item.categoryId)) : [];
  const [unit] = item.unitId ? await db.select().from(units).where(eq(units.id, item.unitId)) : [];
  const [altUnit] = item.altUnitId ? await db.select().from(units).where(eq(units.id, item.altUnitId)) : [];
  const [tax] = item.taxRateId ? await db.select().from(taxRates).where(eq(taxRates.id, item.taxRateId)) : [];

  const isGoods = item.kind === "goods";
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const mv = isGoods ? await itemMovements(db, item.id, from, to) : null;
  const low = isGoods && item.minStockMilli > 0 && (mv?.closingMilli ?? 0) <= item.minStockMilli;

  return (
    <>
      <PageHeader
        back={{ href: "/items", label: "Items & stock" }}
        title={
          <span className="flex items-center gap-2">
            {item.name} {!item.active && <Badge>Inactive</Badge>}
          </span>
        }
        subtitle={item.kind === "service" ? "Service" : `${item.code ? `${item.code} · ` : ""}${category?.name ?? "No category"}`}
        actions={
          <>
            {isGoods && <LinkButton size="sm" href={`/stock-adjustments/new?item=${item.id}`}>Adjust stock</LinkButton>}
            {can(user, "masters.edit") && <LinkButton size="sm" href={`/items/${item.id}/edit`}>Edit</LinkButton>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="no-print flex flex-col gap-4">
          <Panel title="Details">
            <dl className="flex flex-col gap-2 text-sm">
              {region().usesHsn && item.hsn && <Detail k="HSN / SAC" v={item.hsn} />}
              <Detail k="Sale price" v={<Money paise={item.salePricePaise} />} hint={item.salePriceIncludesTax ? "incl. tax" : "excl. tax"} />
              {can(user, "see.purchasePrice") && <Detail k="Purchase price" v={<Money paise={item.purchasePricePaise} />} hint={item.purchasePriceIncludesTax ? "incl. tax" : "excl. tax"} />}
              {item.mrpPaise ? <Detail k="MRP" v={<Money paise={item.mrpPaise} />} /> : null}
              {tax && <Detail k="Tax rate" v={formatPercent(tax.gstBp)} />}
              {unit && <Detail k="Unit" v={altUnit ? `${unit.name} (also ${altUnit.name}, ${formatQty(item.altUnitFactorMilli ?? 0)}:1)` : unit.name} />}
              {isGoods && item.minStockMilli > 0 && <Detail k="Low-stock alert" v={`${formatQty(item.minStockMilli)} ${unit?.code ?? ""}`} />}
              {item.location && <Detail k="Location" v={item.location} />}
              {item.trackBatches && <Detail k="Tracking" v="Batch & expiry" />}
              {item.trackSerials && <Detail k="Tracking" v="Serial numbers" />}
              {item.description && <Detail k="Description" v={<span className="whitespace-pre-line">{item.description}</span>} />}
            </dl>
            {can(user, "masters.delete") && (
              <div className="mt-3 border-t border-line pt-2">
                <DeleteMasterButton kind="item" id={item.id} name={item.name} />
              </div>
            )}
          </Panel>
          {can(user, "masters.edit") && <ItemPricesPanel itemId={item.id} normalPricePaise={item.salePricePaise} rows={await getItemPrices(db, user.firmId, item.id)} />}
          {isGoods && mv && (
            <Panel title="Current stock">
              <div className={low ? "text-lg font-semibold text-warn" : "text-lg font-semibold"}>
                {formatQty(mv.closingMilli)} {unit?.code}
              </div>
              {low && <p className="mt-1 text-xs text-warn">At or below the low-stock alert.</p>}
              {can(user, "see.stockValue") && (
                <div className="mt-2 text-sm text-muted">
                  Value at cost: <Money paise={Math.max(0, mv.closingMilli) * item.purchasePricePaise / 1000} />
                </div>
              )}
            </Panel>
          )}
        </div>

        {isGoods && mv ? (
          <Panel
            title={`Stock movement · ${formatDate(from)} – ${formatDate(to)}`}
            padded={false}
            actions={
              <div className="no-print flex items-center gap-2">
                <DateRange from={from} to={to} />
                <PrintButton />
              </div>
            }
          >
            <Table>
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Entry</th>
                  <th className={th + " text-right"}>In</th>
                  <th className={th + " text-right"}>Out</th>
                  <th className={th + " text-right"}>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-ground/40">
                  <td className={td}>{formatDate(from)}</td>
                  <td className={td + " font-medium"}>Opening stock</td>
                  <td className={td} />
                  <td className={td} />
                  <td className={td + " text-right"}>
                    {formatQty(mv.openingMilli)} {unit?.code}
                  </td>
                </tr>
                {mv.entries.map((e, i) => (
                  <tr key={i} className="hover:bg-ground/60">
                    <td className={td + " whitespace-nowrap"}>{formatDate(e.date)}</td>
                    <td className={td}>
                      {e.voucher_id && e.type ? (
                        <Link className="text-brand-600 hover:underline" href={`${VOUCHER_INFO[e.type].path}/${e.voucher_id}`}>
                          {VOUCHER_INFO[e.type].label} {e.prefix}
                          {e.number}
                        </Link>
                      ) : (
                        "Opening balance"
                      )}
                      {e.party_name && <div className="text-xs text-faint">{e.party_name}</div>}
                      {e.batch_no && <div className="text-xs text-faint">Batch {e.batch_no}</div>}
                    </td>
                    <td className={td + " text-right"}>{e.qty_milli > 0 ? formatQty(e.qty_milli) : ""}</td>
                    <td className={td + " text-right"}>{e.qty_milli < 0 ? formatQty(-e.qty_milli) : ""}</td>
                    <td className={td + " text-right font-medium"}>
                      {formatQty(e.balance_milli)} {unit?.code}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={td} colSpan={4}>
                    Closing stock
                  </td>
                  <td className={td + " text-right"}>
                    {formatQty(mv.closingMilli)} {unit?.code}
                  </td>
                </tr>
              </tbody>
            </Table>
          </Panel>
        ) : (
          <Panel>
            <p className="text-sm text-muted">Services don&apos;t track stock. Sales of this item still appear on your reports.</p>
          </Panel>
        )}
      </div>
    </>
  );
}

function Detail({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd>
        {v}
        {hint && <span className="ml-1 text-xs text-faint">{hint}</span>}
      </dd>
    </div>
  );
}
