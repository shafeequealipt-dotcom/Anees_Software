import { notFound } from "next/navigation";
import { CombineList } from "@/components/combine-list";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { typeFromPath, VOUCHER_INFO } from "@/lib/voucher-types";
import { listCombinable } from "@/server/vouchers";

export const metadata = { title: "Combine into one bill" };

export default async function CombinePage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const target = typeFromPath(section);
  if (target !== "sale_invoice" && target !== "purchase_bill") notFound();
  const user = await requireUser("vouchers.create");
  const groups = await listCombinable(await getDb(), user.firmId, target);
  const info = VOUCHER_INFO[target];
  return (
    <>
      <PageHeader
        title={`Combine into one ${info.label.toLowerCase()}`}
        subtitle={target === "sale_invoice" ? "Tick the quotations, sales orders and delivery challans of one customer that belong on the same bill." : "Tick the purchase orders of one supplier that belong on the same bill."}
        back={{ href: info.path, label: info.plural }}
      />
      <CombineList target={info.path} groups={groups.map((g) => ({ partyId: g.partyId, partyName: g.partyName, docs: g.docs.map((d) => ({ id: d.id, label: `${VOUCHER_INFO[d.type].label} ${d.prefix}${d.number}`, date: d.date, totalPaise: d.totalPaise })) }))} />
    </>
  );
}
