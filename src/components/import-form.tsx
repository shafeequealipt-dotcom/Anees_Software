"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Panel, Table, td, th } from "./ui";

interface Result {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
  dryRun: boolean;
  error?: string;
}

export function ImportForm({ kind, templateHref, exportHref, backHref, canUpdate }: { kind: "parties" | "items"; templateHref: string; exportHref?: string; backHref: string; canUpdate?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: "check" | "import") {
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("mode", mode);
    try {
      const r = await fetch(`/api/import/${kind}`, { method: "POST", body });
      const j = (await r.json()) as Result;
      setRes(r.ok ? j : { total: 0, created: 0, updated: 0, skipped: 0, errors: [], dryRun: true, error: j.error ?? "The import failed." });
      if (r.ok && mode === "import") router.refresh();
    } catch {
      setRes({ total: 0, created: 0, updated: 0, skipped: 0, errors: [], dryRun: true, error: "Couldn't reach the server. Check your connection and try again." });
    }
    setBusy(false);
  }

  const words = kind === "parties" ? "parties" : "items";
  const bad = res ? res.errors.filter((e) => !/left as it is/.test(e.message)).length : 0;
  const ready = res && !res.error && res.created + res.updated > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Panel title="1. Get the sheet">
        <p className="text-sm text-muted">
          Download the template, fill it in Excel (one row per {kind === "parties" ? "party" : "item"}), and save it as .xlsx or .csv.
          {canUpdate && " To change many existing items at once, export them, edit the cells, and import the file again."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={templateHref} className="inline-flex h-9 items-center rounded-md border border-line bg-panel px-3.5 text-sm font-medium hover:bg-ground">
            Download template
          </a>
          {exportHref && (
            <a href={exportHref} className="inline-flex h-9 items-center rounded-md border border-line bg-panel px-3.5 text-sm font-medium hover:bg-ground">
              Export current {words}
            </a>
          )}
        </div>
      </Panel>

      <Panel title="2. Check your file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setRes(null);
            }}
            className="text-sm"
          />
          <Button variant="primary" onClick={() => send("check")} disabled={!file || busy}>
            {busy ? "Working…" : "Check file"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-faint">Checking doesn&apos;t save anything.</p>
      </Panel>

      {res?.error && <Alert tone="bad">{res.error}</Alert>}
      {res && !res.error && (
        <Panel title={res.dryRun ? "Result of the check" : "Import finished"}>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>{res.total} rows read</span>
            <span className="text-good">{res.created} to add</span>
            {res.updated > 0 && <span className="text-good">{res.updated} to update</span>}
            {res.skipped > 0 && <span className="text-muted">{res.skipped} skipped</span>}
            {bad > 0 && <span className="text-bad">{bad} with problems</span>}
          </div>
          {res.errors.length > 0 && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-line">
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Row</th>
                    <th className={th}>What to fix</th>
                  </tr>
                </thead>
                <tbody>
                  {res.errors.map((e, i) => (
                    <tr key={i}>
                      <td className={td + " num"}>{e.line}</td>
                      <td className={td}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {res.dryRun ? (
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" onClick={() => send("import")} disabled={busy || !ready}>
                {busy ? "Importing…" : `Import ${res.created + res.updated} ${words}`}
              </Button>
              {bad > 0 && <span className="text-xs text-muted">Rows with problems will be skipped. Fix them in the sheet and import again.</span>}
            </div>
          ) : (
            <div className="mt-4">
              <Button variant="primary" onClick={() => router.push(backHref)}>
                Go to {words}
              </Button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
