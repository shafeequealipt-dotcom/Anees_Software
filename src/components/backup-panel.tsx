"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { requestBackupAction } from "@/app/actions/admin";
import { formatDateTime } from "@/lib/dates";
import { Alert, Badge, Button, Panel, Table, td, th } from "./ui";

interface Props {
  lastSnapshotOk: { at: string; file: string | null; size: number | null } | null;
  lastSnapshotFailed: { at: string; message: string | null } | null;
  lastPitr: string | null;
  lastVerify: string | null;
  open: boolean;
  requests: { id: number; status: string; at: string; finished: string | null; message: string | null; by: string | null }[];
  runs: { id: number; kind: string; at: string; ok: boolean; file: string | null; size: number | null; message: string | null }[];
}

const KIND: Record<string, string> = { snapshot: "Nightly snapshot", "pitr-full": "Full point-in-time backup", "pitr-diff": "Point-in-time update", "pitr-setup": "Point-in-time setup", "pitr-verify": "Test restore", yearly: "Year-end archive" };
const STATUS: Record<string, string> = { pending: "Waiting for the server", running: "Running", done: "Done", failed: "Failed" };

const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? "less than an hour ago" : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
};
const mb = (n: number | null) => (n ? `${(n / 1_048_576).toFixed(1)} MB` : "");

export function BackupPanel({ lastSnapshotOk, lastSnapshotFailed, lastPitr, lastVerify, open, requests, runs }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a request is open, look again every 20 seconds.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [open, router]);

  const fresh = lastSnapshotOk && Date.now() - Date.parse(lastSnapshotOk.at) < 26 * 3_600_000;

  async function backupNow() {
    setBusy(true);
    setError(null);
    const res = await requestBackupAction();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {!lastSnapshotOk ? (
        <Alert tone="bad">No backup has ever completed. Your data is only on this server until backups are set up. {lastSnapshotFailed?.message ? `Last attempt: ${lastSnapshotFailed.message}` : "Ask the person who manages the server to finish backup setup (encryption key and storage keys)."}</Alert>
      ) : fresh ? (
        <Alert tone="good">Last successful backup {ago(lastSnapshotOk.at)} ({formatDateTime(lastSnapshotOk.at)}).</Alert>
      ) : (
        <Alert tone="bad">The last successful backup was {ago(lastSnapshotOk.at)}. Backups should run every night. Something is wrong.</Alert>
      )}

      <Panel
        title="Backup now"
        actions={
          <Button variant="primary" size="sm" onClick={backupNow} disabled={busy || open}>
            {open ? "A backup is in progress…" : busy ? "Asking…" : "Back up now"}
          </Button>
        }
      >
        {error && <div className="mb-2"><Alert tone="bad">{error}</Alert></div>}
        <p className="text-sm text-muted">
          A full encrypted copy of all your companies, bills and uploaded files is taken every night and sent to Oracle storage and Google Drive. Press the button to take one right now; the server starts it within a couple of minutes. The copies can only be opened with the private key that you (the owner) keep.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Nightly snapshot</dt>
            <dd>{lastSnapshotOk ? `${ago(lastSnapshotOk.at)} ${mb(lastSnapshotOk.size)}` : "Never"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Point-in-time protection</dt>
            <dd>{lastPitr ? ago(lastPitr) : "Not set up"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Last test restore</dt>
            <dd>{lastVerify ? ago(lastVerify) : "Never"}</dd>
          </div>
        </dl>
      </Panel>

      {requests.length > 0 && (
        <Panel title="Your requests" padded={false}>
          <Table>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className={td + " whitespace-nowrap text-muted"}>{formatDateTime(r.at)}</td>
                  <td className={td}>{r.by}</td>
                  <td className={td}>
                    <Badge tone={r.status === "done" ? "good" : r.status === "failed" ? "bad" : "brand"}>{STATUS[r.status] ?? r.status}</Badge>
                  </td>
                  <td className={td + " text-xs text-muted"}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <Panel title="History" padded={false}>
        {runs.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>What</th>
                <th className={th}>Result</th>
                <th className={th}>Size</th>
                <th className={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className={td + " whitespace-nowrap text-muted"}>{formatDateTime(r.at)}</td>
                  <td className={td}>{KIND[r.kind] ?? r.kind}</td>
                  <td className={td}>
                    <Badge tone={r.ok ? "good" : "bad"}>{r.ok ? "OK" : "Problem"}</Badge>
                  </td>
                  <td className={td + " text-muted"}>{mb(r.size)}</td>
                  <td className={td + " max-w-md text-xs text-muted"}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
