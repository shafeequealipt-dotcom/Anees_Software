"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCategoryAction, saveCategoryNameAction } from "@/app/actions/admin";
import { Alert, Button, Input, Panel } from "./ui";

type Kind = "item" | "expense" | "income";

export function CategoryManager({ kind, title, hint, rows }: { kind: Kind; title: string; hint: string; rows: { id: number; name: string; used: number }[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    done?.();
    router.refresh();
  }

  return (
    <Panel title={title} padded={false}>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">{hint}</p>
      {error && <div className="p-3"><Alert tone="bad">{error}</Alert></div>}
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            {editing?.id === r.id ? (
              <>
                <Input value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} className="h-8" autoFocus />
                <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => saveCategoryNameAction(kind, r.id, editing.name), () => setEditing(null))}>
                  Save
                </Button>
                <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              </>
            ) : (
              <>
                <span className="flex-1">{r.name}</span>
                <span className="text-xs text-faint">{r.used} in use</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: r.id, name: r.name })}>Rename</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm(`Delete "${r.name}"?`) && run(() => deleteCategoryAction(kind, r.id))}>
                  Delete
                </Button>
              </>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-3 text-sm text-muted">None yet.</li>}
      </ul>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim()) run(() => saveCategoryNameAction(kind, undefined, adding), () => setAdding(""));
        }}
      >
        <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New category" className="h-8" />
        <Button size="sm" variant="primary" type="submit" disabled={busy || !adding.trim()}>
          Add
        </Button>
      </form>
    </Panel>
  );
}
