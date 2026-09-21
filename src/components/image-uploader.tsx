"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Panel } from "./ui";

export function ImageUploader({ kind, title, hint, has, version }: { kind: "logo" | "signature"; title: string; hint: string; has: boolean; version: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    const r = await fetch("/api/company/image", { method: "POST", body });
    setBusy(false);
    if (!r.ok) return setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "The upload failed.");
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Remove the ${kind}?`)) return;
    setBusy(true);
    await fetch(`/api/company/image?kind=${kind}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <Panel title={title}>
      {error && <div className="mb-2"><Alert tone="bad">{error}</Alert></div>}
      <div className="flex items-center gap-4">
        <div className="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-line bg-ground/50">
          {has ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/company/image?kind=${kind}&v=${version}`} alt={title} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-faint">None</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="max-w-xs text-xs text-muted">{hint}</p>
          <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? "Working…" : has ? "Replace" : "Upload"}
            </Button>
            {has && (
              <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
