import { redirect } from "next/navigation";
import { EInvoicingPanel } from "@/components/einvoicing-panel";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { certificateInfo, getZatca, listZatcaInvoices } from "@/server/zatca";
import { eq } from "drizzle-orm";
import { firms } from "@/db/schema";

export const metadata = { title: "E-invoicing (ZATCA)" };

export default async function EInvoicingPage() {
  const user = await requireUser("settings.edit");
  if (user.firm.country !== "SA") redirect("/settings/business");
  const db = await getDb();
  const [z, invoices, [firm]] = await Promise.all([getZatca(db, user.firmId), listZatcaInvoices(db, user.firmId, 60), db.select().from(firms).where(eq(firms.id, user.firmId))]);
  return (
    <EInvoicingPanel
      hasVat={!!firm?.gstin}
      settings={{
        environment: (z?.environment ?? "sandbox") as "sandbox" | "simulation" | "production",
        status: z?.status ?? "not_started",
        enabled: z?.enabled ?? false,
        crn: z?.crn ?? "",
        branchName: z?.branchName ?? "",
        businessCategory: z?.businessCategory ?? "",
        shortAddress: z?.shortAddress ?? "",
        street: z?.street ?? "",
        building: z?.building ?? "",
        district: z?.district ?? "",
        city: z?.city ?? "",
        postal: z?.postal ?? "",
      }}
      lastCheck={(z?.lastCheck as { at: string; results: { label: string; ok: boolean; status: number; messages: string[] }[] } | null) ?? null}
      certificate={certificateInfo(z?.productionCert ?? z?.complianceCert ?? null)}
      invoices={invoices.map((i) => ({ id: i.id, voucherId: i.voucherId, icv: i.icv, kind: i.kind, status: i.status, error: i.error, at: i.createdAt.toISOString() }))}
    />
  );
}
