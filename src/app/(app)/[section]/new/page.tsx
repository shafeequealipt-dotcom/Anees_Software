import { notFound } from "next/navigation";
import { MoneyForm, PaymentForm } from "@/components/payment-form";
import { Alert } from "@/components/ui";
import { VoucherForm } from "@/components/voucher-form";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { typeFromPath, VOUCHER_INFO } from "@/lib/voucher-types";
import { can } from "@/lib/permissions";
import { loadVoucherFormData } from "@/server/form-data";

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const type = typeFromPath((await params).section);
  return { title: type ? `New ${VOUCHER_INFO[type].label.toLowerCase()}` : "Not found" };
}

export default async function NewVoucherPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ from?: string; party?: string; saved?: string }> }) {
  const { section } = await params;
  const type = typeFromPath(section);
  if (!type) notFound();
  const user = await requireUser(["money_adjustment", "money_transfer", "other_income"].includes(type) ? "money.edit" : "vouchers.create");
  const sp = await searchParams;
  const db = await getDb();
  const data = await loadVoucherFormData(db, user.firmId, type, {
    fromId: sp.from ? Number(sp.from) || undefined : undefined,
    partyId: sp.party ? Number(sp.party) || undefined : undefined,
  }, { balance: can(user, "see.partyBalance"), contact: can(user, "see.partyContact"), purchase: can(user, "see.purchasePrice") });
  const saved = sp.saved ? <div className="mb-3"><Alert tone="good">Saved {sp.saved}. Ready for the next one.</Alert></div> : null;
  if (!data.firm) return <Alert tone="warn">Set up your business first in Settings.</Alert>;
  if (type === "payment_in" || type === "payment_out") return <>{saved}<PaymentForm key={sp.saved ?? "new"} data={data} /></>;
  if (type === "money_adjustment" || type === "money_transfer") return <MoneyForm data={data} />;
  return <>{saved}<VoucherForm key={sp.saved ?? "new"} data={data} /></>;
}
