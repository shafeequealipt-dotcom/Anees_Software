import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Money, PageHeader, Panel, StatusBadge, Table, td, th } from "@/components/ui";
import { VoucherActions } from "@/components/voucher-actions";
import { getDb } from "@/db";
import { accounts, firms, ledgerCategories, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { amountInWords } from "@/lib/amount-in-words";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import QRCode from "qrcode";
import { stateName } from "@/lib/gst/states";
import { region, taxColumnLabels } from "@/lib/region";
import { zatcaQrBase64 } from "@/lib/zatca";
import { formatINR, formatPercent, formatQty } from "@/lib/money";
import { can } from "@/lib/permissions";
import { typeFromPath, VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { getVoucher, paymentStatus } from "@/server/vouchers";

export async function generateMetadata({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section } = await params;
  const type = typeFromPath(section);
  return { title: type ? VOUCHER_INFO[type].label : "Not found" };
}

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ section: string; id: string }>; searchParams: Promise<{ warn?: string; print?: string }> }) {
  const { section, id } = await params;
  const type = typeFromPath(section);
  if (!type || !Number(id)) notFound();
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const data = await getVoucher(db, user.firmId, Number(id));
  if (!data) notFound();
  const v = data.voucher;
  if (v.type !== type) redirect(`${VOUCHER_INFO[v.type].path}/${v.id}`);
  const info = VOUCHER_INFO[v.type];
  const [firm] = await db.select().from(firms).where(eq(firms.id, v.firmId));
  const [account] = v.accountId ? await db.select().from(accounts).where(eq(accounts.id, v.accountId)) : [];
  const [toAccount] = v.toAccountId ? await db.select().from(accounts).where(eq(accounts.id, v.toAccountId)) : [];
  const [category] = v.categoryId ? await db.select().from(ledgerCategories).where(eq(ledgerCategories.id, v.categoryId)) : [];
  const [creator] = v.createdBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, v.createdBy)) : [];
  const [editor] = v.updatedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, v.updatedBy)) : [];

  const R = region();
  const TL = taxColumnLabels(R);
  // Saudi Arabia: tax invoices and credit notes carry a ZATCA (Phase 1) QR code.
  const qrSource = R.country === "SA" && firm?.gstin && ["sale_invoice", "credit_note"].includes(v.type) && v.status === "active";
  const zatcaQr = qrSource
    ? await QRCode.toDataURL(
        zatcaQrBase64({
          sellerName: firm!.name,
          vatNumber: firm!.gstin!,
          timestamp: v.createdAt.toISOString().replace(/\.\d+Z$/, "Z"),
          totalPaise: v.totalPaise,
          vatPaise: v.cgstPaise + v.sgstPaise + v.igstPaise + v.cessPaise,
        }),
        { margin: 1, width: 180 },
      )
    : null;
  const number = voucherNumber(v);
  const status = info.takesPayment && v.partyId ? paymentStatus(v, data.balancePaise) : v.status === "cancelled" ? "cancelled" : null;
  const hasTax = v.cgstPaise + v.sgstPaise + v.igstPaise + v.cessPaise > 0;
  const intra = v.igstPaise === 0;

  const convert = info.convertsTo.map((t) => ({
    href: `${VOUCHER_INFO[t].path}/new?from=${v.id}`,
    label: ["credit_note", "debit_note"].includes(t) ? `Make ${VOUCHER_INFO[t].label.toLowerCase()}` : `Convert to ${VOUCHER_INFO[t].label.toLowerCase()}`,
  }));
  const receivePayment =
    info.takesPayment && v.partyId && data.balancePaise > 0
      ? {
          href: `${info.outward ? "/payments-in" : "/payments-out"}/new?party=${v.partyId}`,
          label: info.outward ? "Receive payment" : "Make payment",
        }
      : undefined;

  const shareText = `${firm?.name ?? ""}: ${info.label} ${number} dated ${formatDate(v.date)} for ${formatINR(v.totalPaise)}${data.balancePaise > 0 ? ` (balance due ${formatINR(data.balancePaise)})` : ""}.`;

  return (
    <>
      <PageHeader
        back={{ href: info.path, label: info.plural }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {info.label} {number} {status && <StatusBadge status={status} />}
          </span>
        }
        subtitle={`${formatDate(v.date)}${v.partyName ? ` · ${v.partyName}` : ""}`}
        actions={
          <VoucherActions
            id={v.id}
            path={info.path}
            editable={can(user, "vouchers.edit")}
            canCancel={can(user, "vouchers.cancel") && info.posts}
            canDelete={can(user, "vouchers.delete")}
            cancelled={v.status === "cancelled"}
            pdf={info.hasLines || v.type === "payment_in" || v.type === "payment_out"}
            share={info.outward || v.type === "payment_in" ? { phone: v.partyPhone, text: shareText } : undefined}
            convert={convert}
            receivePayment={receivePayment}
            autoPrint={!!sp.print}
          />
        }
      />

      {sp.warn && (
        <div className="mb-4 flex flex-col gap-2">
          {sp.warn.split("\n").map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
        </div>
      )}
      {v.status === "cancelled" && (
        <div className="mb-4">
          <Alert tone="bad">This entry is cancelled. It no longer affects balances, stock or reports.</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          {info.hasLines ? (
            <Panel padded={false}>
              <div className="grid gap-4 border-b border-line p-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase text-muted">{info.partySide === "supplier" ? "Supplier" : info.partySide === "none" ? "" : "Bill to"}</div>
                  {v.partyId ? (
                    <Link href={`/parties/${v.partyId}`} className="font-medium text-brand-600 hover:underline">
                      {v.partyName}
                    </Link>
                  ) : (
                    <div className="font-medium">{v.partyName || (info.partySide === "none" ? "" : "Cash")}</div>
                  )}
                  {v.billingAddress && <div className="whitespace-pre-line text-sm text-muted">{v.billingAddress}</div>}
                  {v.partyGstin && <div className="font-mono text-xs text-muted">{R.taxIdLabel} {v.partyGstin}</div>}
                  {v.partyPhone && <div className="text-xs text-muted">{v.partyPhone}</div>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {R.usesStates && v.placeOfSupply && info.partySide !== "none" && <Pair k="Place of supply" v={`${v.placeOfSupply}-${stateName(v.placeOfSupply)}`} />}
                  {v.dueDate && <Pair k={v.type === "quotation" ? "Valid until" : "Due date"} v={formatDate(v.dueDate)} />}
                  {v.supplierInvoiceNo && <Pair k="Supplier bill no." v={v.supplierInvoiceNo} />}
                  {v.originalInvoiceNo && <Pair k="Against bill" v={`${v.originalInvoiceNo}${v.originalInvoiceDate ? `, ${formatDate(v.originalInvoiceDate)}` : ""}`} />}
                  {v.poNumber && <Pair k="PO number" v={v.poNumber} />}
                  {v.ewayBillNo && <Pair k="E-way bill" v={v.ewayBillNo} />}
                  {v.vehicleNo && <Pair k="Vehicle" v={v.vehicleNo} />}
                  {category && <Pair k="Category" v={category.name} />}
                  {v.type === "stock_adjustment" && <Pair k="Adjustment" v={v.direction === -1 ? "Stock reduced" : "Stock added"} />}
                  {v.withoutTax && info.outward && <Pair k="Type" v={R.usesStates ? "Bill of supply" : "No VAT charged"} />}
                  {v.reverseCharge && <Pair k="Reverse charge" v="Yes" />}
                </dl>
              </div>
              <Table>
                <thead>
                  <tr>
                    <th className={th}>#</th>
                    <th className={th}>Item</th>
                    <th className={th + " text-right"}>Qty</th>
                    <th className={th + " text-right"}>Rate</th>
                    {v.discountPaise > 0 && <th className={th + " text-right"}>Discount</th>}
                    {hasTax && <th className={th + " text-right"}>Tax</th>}
                    <th className={th + " text-right"}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td className={td + " text-faint"}>{l.lineNo}</td>
                      <td className={td}>
                        {l.itemId ? (
                          <Link href={`/items/${l.itemId}`} className="hover:underline">
                            {l.description}
                          </Link>
                        ) : (
                          l.description
                        )}
                        <div className="text-xs text-faint">
                          {[R.usesHsn && l.hsn && `HSN ${l.hsn}`, l.batchNo && `Batch ${l.batchNo}`, l.expiryDate && `Exp ${formatDate(l.expiryDate)}`].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className={td + " num text-right"}>
                        {formatQty(l.qtyMilli)} {l.unitCode}
                      </td>
                      <td className={td + " text-right"}>
                        <Money paise={l.ratePaise} />
                        {l.rateIncludesTax && hasTax && <div className="text-xs text-faint">incl. tax</div>}
                      </td>
                      {v.discountPaise > 0 && (
                        <td className={td + " text-right"}>
                          <Money paise={l.lineDiscountPaise + l.billDiscountPaise} blankZero />
                          {l.discountBp > 0 && <div className="text-xs text-faint">{formatPercent(l.discountBp)}</div>}
                        </td>
                      )}
                      {hasTax && (
                        <td className={td + " text-right"}>
                          <Money paise={l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise} blankZero />
                          <div className="text-xs text-faint">
                            {formatPercent(l.gstBp)}
                            {l.cessBp ? ` + cess ${formatPercent(l.cessBp)}` : ""}
                          </div>
                        </td>
                      )}
                      <td className={td + " text-right font-medium"}>
                        <Money paise={l.totalPaise} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex justify-end p-4">
                <dl className="flex w-full max-w-xs flex-col gap-1 text-sm">
                  {v.discountPaise > 0 && <Sum k="Discount" v={-v.discountPaise} />}
                  {hasTax && <Sum k="Taxable value" v={v.taxablePaise} />}
                  {intra && v.cgstPaise > 0 && <Sum k={TL.cgst} v={v.cgstPaise} />}
                  {intra && v.sgstPaise > 0 && <Sum k={TL.sgst} v={v.sgstPaise} />}
                  {v.igstPaise > 0 && <Sum k={TL.igst} v={v.igstPaise} />}
                  {v.cessPaise > 0 && <Sum k="Cess" v={v.cessPaise} />}
                  {v.roundOffPaise !== 0 && <Sum k="Round off" v={v.roundOffPaise} />}
                  <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
                    <span>Total</span>
                    <Money paise={v.totalPaise} />
                  </div>
                  {info.takesPayment && v.paidPaise > 0 && <Sum k={info.outward ? "Received on bill" : "Paid on bill"} v={v.paidPaise} />}
                  {info.takesPayment && v.partyId && (
                    <div className="flex justify-between font-medium">
                      <span>Balance due</span>
                      <Money paise={data.balancePaise} className={data.balancePaise > 0 ? "text-bad" : "text-good"} />
                    </div>
                  )}
                </dl>
              </div>
              <p className="border-t border-line px-4 py-2 text-xs text-muted">{amountInWords(v.totalPaise)}</p>
            </Panel>
          ) : (
            <Panel>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {v.partyName && <Pair k="Party" v={v.partyId ? <Link className="text-brand-600 hover:underline" href={`/parties/${v.partyId}`}>{v.partyName}</Link> : v.partyName} />}
                <Pair k="Amount" v={<Money paise={v.totalPaise} className="text-lg font-semibold" />} />
                {account && <Pair k={v.type === "money_transfer" ? "From" : v.type === "payment_out" ? "Paid from" : "Account"} v={account.name} />}
                {toAccount && <Pair k="To" v={toAccount.name} />}
                {v.type === "money_adjustment" && <Pair k="Type" v={v.direction === -1 ? "Money taken out" : "Money added"} />}
                {v.paymentMode && <Pair k="Mode" v={v.paymentMode} />}
                {v.paymentRef && <Pair k="Reference" v={v.paymentRef} />}
              </dl>
              <p className="mt-3 text-xs text-muted">{amountInWords(v.totalPaise)}</p>
            </Panel>
          )}

          {(v.notes || v.terms) && (
            <Panel>
              {v.notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted">Notes</div>
                  <p className="whitespace-pre-line text-sm">{v.notes}</p>
                </div>
              )}
              {v.terms && (
                <div className={v.notes ? "mt-3" : ""}>
                  <div className="text-xs font-medium uppercase text-muted">Terms</div>
                  <p className="whitespace-pre-line text-sm">{v.terms}</p>
                </div>
              )}
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {(data.settledBy.length > 0 || (info.takesPayment && v.paidPaise > 0)) && (
            <Panel title="Payments">
              <ul className="flex flex-col gap-2 text-sm">
                {v.paidPaise > 0 && info.takesPayment && (
                  <li className="flex justify-between gap-2">
                    <span>
                      On the bill{account ? ` · ${account.name}` : ""}
                      {v.paymentMode ? ` · ${v.paymentMode}` : ""}
                    </span>
                    <Money paise={v.paidPaise} />
                  </li>
                )}
                {data.settledBy.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <Link href={`${VOUCHER_INFO[s.type].path}/${s.id}`} className="text-brand-600 hover:underline">
                      {VOUCHER_INFO[s.type].label} {voucherNumber(s)} · {formatDate(s.date)}
                    </Link>
                    <Money paise={s.amountPaise} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {data.settles.length > 0 && (
            <Panel title="Settled bills">
              <ul className="flex flex-col gap-2 text-sm">
                {data.settles.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <Link href={`${VOUCHER_INFO[s.type].path}/${s.id}`} className="text-brand-600 hover:underline">
                      {VOUCHER_INFO[s.type].label} {voucherNumber(s)}
                    </Link>
                    <Money paise={s.amountPaise} />
                  </li>
                ))}
                {v.type.startsWith("payment") && v.totalPaise - data.settles.reduce((s, x) => s + x.amountPaise, 0) > 0 && (
                  <li className="flex justify-between gap-2 text-muted">
                    <span>Kept as advance</span>
                    <Money paise={v.totalPaise - data.settles.reduce((s, x) => s + x.amountPaise, 0)} />
                  </li>
                )}
              </ul>
            </Panel>
          )}
          {(data.source || data.converted.length > 0) && (
            <Panel title="Linked entries">
              <ul className="flex flex-col gap-2 text-sm">
                {data.source && (
                  <li>
                    Made from{" "}
                    <Link className="text-brand-600 hover:underline" href={`${VOUCHER_INFO[data.source.type].path}/${data.source.id}`}>
                      {VOUCHER_INFO[data.source.type].label.toLowerCase()} {voucherNumber(data.source)}
                    </Link>
                  </li>
                )}
                {data.converted.map((c) => (
                  <li key={c.id}>
                    Converted to{" "}
                    <Link className="text-brand-600 hover:underline" href={`${VOUCHER_INFO[c.type].path}/${c.id}`}>
                      {VOUCHER_INFO[c.type].label.toLowerCase()} {voucherNumber(c)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {zatcaQr && (
            <Panel title="ZATCA QR code">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={zatcaQr} alt="ZATCA QR code for this invoice" width={180} height={180} className="mx-auto" />
              <p className="mt-2 text-xs text-muted">
                Seller {firm!.name} · VAT no. {firm!.gstin}. Scan with the ZATCA/Fatoora app to check the details.
              </p>
            </Panel>
          )}
          <Panel title="Record">
            <dl className="flex flex-col gap-1 text-xs text-muted">
              <div>
                Created {formatDateTime(v.createdAt)}
                {creator ? ` by ${creator.name}` : ""}
              </div>
              {v.updatedAt.getTime() - v.createdAt.getTime() > 2000 && (
                <div>
                  Last changed {formatDateTime(v.updatedAt)}
                  {editor ? ` by ${editor.name}` : ""}
                </div>
              )}
              {can(user, "audit.view") && (
                <Link href={`/settings/audit?entity=voucher&id=${v.id}`} className="text-brand-600 hover:underline">
                  See full change history
                </Link>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="text-right sm:text-left">{v}</dd>
    </>
  );
}

function Sum({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{k}</span>
      <Money paise={v} />
    </div>
  );
}
