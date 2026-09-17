"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cancelVoucherAction, deleteVoucherAction, shareLinkAction } from "@/app/actions/vouchers";
import { Alert, Button, buttonClass } from "./ui";

export function VoucherActions({
  id,
  path,
  editable,
  canCancel,
  canDelete,
  cancelled,
  pdf,
  share,
  convert,
  receivePayment,
  autoPrint,
}: {
  id: number;
  path: string;
  editable: boolean;
  canCancel: boolean;
  canDelete: boolean;
  cancelled: boolean;
  pdf: boolean;
  share?: { phone: string | null; text: string };
  convert: { href: string; label: string }[];
  receivePayment?: { href: string; label: string };
  autoPrint?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (autoPrint && pdf) window.open(`/api/vouchers/${id}/pdf`, "_blank");
  }, [autoPrint, pdf, id]);

  async function shareWhatsApp() {
    if (!share) return;
    setBusy(true);
    const res = await shareLinkAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const phone = (share.phone ?? "").replace(/\D/g, "");
    const intl = phone.length === 10 ? `91${phone}` : phone;
    const msg = `${share.text}\n\nView / download: ${res.url}`;
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  async function copyLink() {
    setBusy(true);
    const res = await shareLinkAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await navigator.clipboard.writeText(res.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function cancel() {
    if (!confirm("Cancel this entry? It stays on record marked Cancelled, and stops counting in balances, stock and reports.")) return;
    setBusy(true);
    const res = await cancelVoucherAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this entry permanently? This can't be undone. (Cancelling keeps a record instead.)")) return;
    setBusy(true);
    const res = await deleteVoucherAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push(path);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {pdf && (
          <>
            <a className={buttonClass("secondary", "sm")} href={`/api/vouchers/${id}/pdf`} target="_blank" rel="noopener">
              Print / PDF
            </a>
            <a className={buttonClass("secondary", "sm")} href={`/api/vouchers/${id}/pdf?download=1`}>
              Download
            </a>
          </>
        )}
        {pdf && share && !cancelled && (
          <>
            <Button size="sm" onClick={shareWhatsApp} disabled={busy}>
              WhatsApp
            </Button>
            <Button size="sm" onClick={copyLink} disabled={busy}>
              {copied ? "Link copied" : "Copy link"}
            </Button>
          </>
        )}
        {receivePayment && !cancelled && (
          <Link className={buttonClass("primary", "sm")} href={receivePayment.href}>
            {receivePayment.label}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {!cancelled &&
          convert.map((c) => (
            <Link key={c.href} className={buttonClass("ghost", "sm")} href={c.href}>
              {c.label}
            </Link>
          ))}
        {editable && !cancelled && (
          <Link className={buttonClass("secondary", "sm")} href={`${path}/${id}/edit`}>
            Edit
          </Link>
        )}
        {canCancel && !cancelled && (
          <Button size="sm" variant="danger" onClick={cancel} disabled={busy}>
            Cancel entry
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="text-bad" onClick={remove} disabled={busy}>
            Delete
          </Button>
        )}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
    </div>
  );
}
