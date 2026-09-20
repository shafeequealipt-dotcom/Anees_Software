import type { Metadata } from "next";
import { getDb } from "@/db";
import { loadInvoiceModel } from "@/server/invoice";
import { resolveShare } from "@/server/share";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const link = await resolveShare(db, token);
  const model = link ? await loadInvoiceModel(db, link.firmId, link.voucherId) : null;

  if (!model) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 text-center">
        <h1 className="text-lg font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm text-muted">Ask the business to send you a new link.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{model.seller.name}</div>
          {model.seller.lines.map((l, i) => (
            <div key={i} className="text-sm text-muted">
              {l}
            </div>
          ))}
          {model.seller.taxId && (
            <div className="text-sm text-muted">
              {model.seller.taxIdLabel}: {model.seller.taxId}
            </div>
          )}
        </div>
        <a href={`/api/share/${token}/pdf`} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Download PDF
        </a>
      </div>

      <div className="rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap justify-between gap-4 border-b border-line p-4">
          <div>
            <div className="text-base font-semibold">{model.title}</div>
            {model.party.name && <div className="mt-2 font-medium">{model.party.name}</div>}
            {model.party.lines.map((l, i) => (
              <div key={i} className="text-sm text-muted">
                {l}
              </div>
            ))}
          </div>
          <dl className="text-sm">
            {model.meta.map((r) => (
              <div key={r.k} className="flex gap-3">
                <dt className="w-32 text-muted">{r.k}</dt>
                <dd className="font-medium">{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {model.kind === "invoice" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-ground/60 text-left text-xs uppercase text-muted">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {model.lines.map((l) => (
                  <tr key={l.no} className="border-b border-line">
                    <td className="px-3 py-2">{l.desc}</td>
                    <td className="px-3 py-2 text-right">{l.qty}</td>
                    <td className="num px-3 py-2 text-right">{l.rate}</td>
                    <td className="num px-3 py-2 text-right font-medium">{l.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          model.receipt && (
            <div className="p-4 text-sm">
              <div className="text-lg font-semibold">
                {model.currency} {model.receipt.amount}
              </div>
              {model.receipt.mode && <div className="text-muted">{model.receipt.mode}</div>}
            </div>
          )
        )}

        <div className="ml-auto max-w-xs p-4">
          {model.totals.map((t) => (
            <div key={t.k} className={`flex justify-between py-0.5 text-sm ${t.bold ? "border-t border-line pt-1.5 font-semibold" : ""}`}>
              <span>{t.k}</span>
              <span className="num">
                {model.currency} {t.v}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-4 py-3 text-xs text-muted">{model.words}</div>
      </div>
      <p className="mt-4 text-center text-xs text-faint">Shared by {model.seller.name}. This link stops working after 90 days.</p>
    </main>
  );
}
