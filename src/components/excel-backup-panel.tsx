"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Panel, cx } from "./ui";

interface CheckResult {
  ok: boolean;
  companies?: string[];
  rows?: number;
  error?: string;
}

export function ExcelBackupPanel({ companies, canRestore }: { companies: { id: number; name: string }[]; canRestore: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [which, setWhich] = useState<string>("all");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<{ companies: string[]; rows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const several = companies.length > 1;
  const chosenName = which === "all" ? null : companies.find((c) => String(c.id) === which)?.name;

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/backup/excel${which === "all" ? "" : `?company=${which}`}`);
      if (!res.ok) throw new Error(await res.text());
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "backup.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Couldn't prepare the backup. Try again in a moment.");
    }
    setDownloading(false);
  }

  function pick(f: File | null) {
    setFile(f);
    setChecked(null);
    setRestored(null);
    setError(null);
  }

  async function send(mode: "check" | "restore") {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const r = await fetch(`/api/backup/excel?mode=${mode}`, { method: "POST", body });
      const j = r.status === 413 ? { ok: false, error: "The file is larger than the server accepts. Ask whoever manages the server to raise the upload limit." } : ((await r.json()) as CheckResult);
      if (!r.ok || !j.ok) setError(j.error ?? "The file couldn't be read.");
      else if (mode === "check") setChecked(j);
      else {
        pick(null);
        if (input.current) input.current.value = "";
        setRestored({ companies: j.companies!, rows: j.rows! });
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  function restore() {
    if (!checked?.companies) return;
    const n = checked.companies.length;
    if (!confirm(`Add ${n === 1 ? "this company" : `these ${n} companies`} as new, separate ${n === 1 ? "company" : "companies"}?\n\n${checked.companies.join("\n")}\n\nNothing already in the app is changed or removed.`)) return;
    void send("restore");
  }

  return (
    <Panel title="Excel backup">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Download</h3>
            <p className="mt-1 text-sm text-muted">One Excel file with every party, item and bill — a sheet for each kind of record. Keep it somewhere safe.</p>
          </div>
          {several && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Company</span>
              <select
                value={which}
                onChange={(e) => setWhich(e.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                <option value="all">All companies ({companies.length})</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div>
            <Button variant="primary" onClick={download} disabled={downloading}>
              {downloading ? "Preparing…" : several ? (chosenName ? `Download ${chosenName}` : "Download all companies") : "Download backup"}
            </Button>
          </div>
          {downloadError && <Alert tone="bad">{downloadError}</Alert>}
        </div>

        {canRestore && (
          <div className="flex flex-col gap-3 border-line max-md:border-t max-md:pt-5 md:border-l md:pl-6">
            <div>
              <h3 className="text-sm font-semibold text-ink">Restore</h3>
              <p className="mt-1 text-sm text-muted">Bring a downloaded file back. It&apos;s added as a new company — what&apos;s already here is never changed.</p>
            </div>
            <label
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-sm transition-colors",
                file ? "border-brand-200 bg-brand-50/50" : "border-line hover:border-brand-200 hover:bg-ground",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="size-4" aria-hidden="true">
                  <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5M4 13.5V15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{file ? file.name : "Choose a backup file"}</span>
                <span className="block text-xs text-faint">{file ? `${(file.size / 1024).toFixed(0)} KB` : ".xlsx downloaded from this page"}</span>
              </span>
              <input ref={input} type="file" accept=".xlsx" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="sr-only" />
            </label>

            {file && !checked && (
              <div>
                <Button onClick={() => send("check")} disabled={busy}>
                  {busy ? "Checking…" : "Check file"}
                </Button>
              </div>
            )}
            {error && <Alert tone="bad">{error}</Alert>}
            {checked?.ok && (
              <>
                <Alert tone="brand">
                  {checked.rows!.toLocaleString()} rows · {checked.companies!.join(", ")}
                </Alert>
                <div>
                  <Button variant="primary" onClick={restore} disabled={busy}>
                    {busy ? "Restoring…" : checked.companies!.length === 1 ? "Add as new company" : `Add ${checked.companies!.length} new companies`}
                  </Button>
                </div>
              </>
            )}
            {restored && (
              <Alert tone="good">
                Restored {restored.companies.join(", ")}. Switch to it from the company menu at the top.
              </Alert>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
