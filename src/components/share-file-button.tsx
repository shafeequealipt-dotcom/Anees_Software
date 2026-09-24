"use client";

import { useState } from "react";
import { Button } from "./ui";

/**
 * Fetches a PDF and opens the phone's own share sheet with the file attached — pick WhatsApp and
 * a contact from there. Works on Android Chrome and iPhone Safari. Desktop browsers (and any
 * browser without file-sharing support) fall back to opening a WhatsApp message with a link,
 * since desktop WhatsApp can't be handed a file this way.
 */
export function ShareFileButton({ url, filename, title, text, label = "Share" }: { url: string; filename: string; title: string; text?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("prepare-failed");
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type || "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
      } else if (text) {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`, "_blank", "noopener");
      } else {
        window.open(url, "_blank", "noopener");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return; // the person closed the share sheet
      setError("Couldn't share — try Download instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button size="sm" onClick={share} disabled={busy}>
        {busy ? "Preparing…" : label}
      </Button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
