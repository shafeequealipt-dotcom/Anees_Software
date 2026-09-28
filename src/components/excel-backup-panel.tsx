"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Panel } from "./ui";

interface CheckResult {
  ok: boolean;
  companies?: string[];
  rows?: number;
  error?: string;
}

export function ExcelBackupPanel({ canRestore }: { canRestore: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<{ companies: string[]; rows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch("/api/backup/excel");
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `billing-backup-${stamp}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download the backup. Try again in a moment.");
    }
    setDownloading(false);
  }

  function pick(f: File | null) {
    setFile(f);
    setChecked(null);
    setRestored(null);
    setError(null);
  }

  async function check() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const r = await fetch("/api/backup/excel?mode=check", { method: "POST", body });
      const j = (await r.json()) as CheckResult;
      if (!r.ok || !j.ok) setError(j.error ?? "The file couldn't be read.");
      else setChecked(j);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  async function restore() {
    if (!file || !checked) return;
    if (!confirm(`Add ${checked.companies!.length === 1 ? "this company" : "these companies"} as new, separate ${checked.companies!.length === 1 ? "company" : "companies"}?\n\n${checked.companies!.join("\n")}\n\nNothing already in the app is changed or removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const r = await fetch("/api/backup/excel?mode=restore", { method: "POST", body });
      const j = (await r.json()) as CheckResult;
      if (!r.ok || !j.ok) setError(j.error ?? "The restore failed.");
      else {
        setRestored({ companies: j.companies!, rows: j.rows! });
        setFile(null);
        setChecked(null);
        if (input.current) input.current.value = "";
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <Panel title="Excel backup">
      <p className="text-sm text-muted">
        A single Excel file with all your business data — every company, party, item and bill, one sheet per kind of record. Keep a copy somewhere safe. It can be brought back at any time as a new company, without touching what&apos;s already in the app.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={download} disabled={downloading}>
          {downloading ? "Preparing…" : "Download all data (Excel)"}
        </Button>
      </div>

      {canRestore && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Restore from Excel</h3>
          <p className="mt-1 text-sm text-muted">Choose a backup file downloaded from here. It&apos;s added as a new company — your current data is never changed.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input ref={input} type="file" accept=".xlsx" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="text-sm" />
            <Button onClick={check} disabled={!file || busy}>
              {busy ? "Working…" : "Check file"}
            </Button>
          </div>

          {error && (
            <div className="mt-3">
              <Alert tone="bad">{error}</Alert>
            </div>
          )}

          {checked?.ok && (
            <div className="mt-3 flex flex-col gap-3">
              <Alert tone="brand">
                This file has {checked.rows!.toLocaleString()} rows across {checked.companies!.length} {checked.companies!.length === 1 ? "company" : "companies"}: {checked.companies!.join(", ")}.
              </Alert>
              <div>
                <Button variant="primary" onClick={restore} disabled={busy}>
                  {busy ? "Restoring…" : "Add as new company"}
                </Button>
              </div>
            </div>
          )}

          {restored && (
            <div className="mt-3">
              <Alert tone="good">
                Restored {restored.rows.toLocaleString()} rows as {restored.companies.length === 1 ? "a new company" : "new companies"}: {restored.companies.join(", ")}. Switch to it from the company menu at the top of the page.
              </Alert>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
