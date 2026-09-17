import { notFound, redirect } from "next/navigation";
import { MoneyForm, PaymentForm } from "@/components/payment-form";
import { VoucherForm } from "@/components/voucher-form";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { typeFromPath, VOUCHER_INFO } from "@/lib/voucher-types";
import { loadVoucherFormData } from "@/server/form-data";

export const metadata = { title: "Edit" };

export default async function EditVoucherPage({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section, id } = await params;
  const type = typeFromPath(section);
  if (!type || !Number(id)) notFound();
  await requireUser("vouchers.edit");
  const db = await getDb();
  const data = await loadVoucherFormData(db, type, { id: Number(id) });
  if (!data.existing) notFound();
  if (data.existing.voucher.type !== type) redirect(`${VOUCHER_INFO[data.existing.voucher.type].path}/${id}/edit`);
  if (data.existing.voucher.status === "cancelled") redirect(`${VOUCHER_INFO[type].path}/${id}`);
  if (type === "payment_in" || type === "payment_out") return <PaymentForm data={data} />;
  if (type === "money_adjustment" || type === "money_transfer") return <MoneyForm data={data} />;
  return <VoucherForm data={data} />;
}
