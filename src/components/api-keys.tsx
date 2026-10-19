"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/api-keys";
import { Alert, Badge, Button, Field, Input, Panel, Select, Table, td, th } from "./ui";

interface KeyRow {
  id: number;
  name: string;
  hint: string;
  firmName: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function ApiKeys({ keys, companies, currentFirmId }: { keys: KeyRow[]; companies: { id: number; name: string }[]; currentFirmId: number }) {
  const router = useRouter();
  const [name, setName] = useState("Claude bookkeeping");
  const [firmId, setFirmId] = useState(currentFirmId);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await createApiKeyAction(name, firmId);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setToken(res.token);
    router.refresh();
  }

  async function revoke(k: KeyRow) {
    if (!confirm(`Revoke "${k.name}"? Anything using it stops working straight away.`)) return;
    const res = await revokeApiKeyAction(k.id);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Make an API key">
        <p className="mb-3 text-sm text-muted">
          A key lets a program enter purchase bills, expenses, payments and transfers into one company, through the app&apos;s usual checks. Entries are made in your name, and the activity log says which key made them. Keys can&apos;t delete anything or change settings.
        </p>
        {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
        {token ? (
          <div className="flex flex-col gap-2">
            <Alert tone="good">Key made. Copy it now — it won&apos;t be shown again. Treat it like a password.</Alert>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded-md border border-line bg-ground px-3 py-2 font-mono text-sm">{token}</code>
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(token);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setToken(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Company">
              <Select value={firmId} onChange={(e) => setFirmId(Number(e.target.value))}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>
              {busy ? "Making…" : "Make key"}
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Keys" padded={false}>
        {keys.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No keys yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Company</th>
                <th className={th}>Made</th>
                <th className={th}>Last used</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.revokedAt ? "opacity-60" : ""}>
                  <td className={td}>
                    <div className="font-medium">{k.name}</div>
                    <div className="font-mono text-xs text-faint">{k.hint}…</div>
                  </td>
                  <td className={td}>{k.firmName}</td>
                  <td className={td + " text-muted"}>
                    {k.createdAt} · {k.createdBy}
                  </td>
                  <td className={td + " text-muted"}>{k.lastUsedAt ?? "Never"}</td>
                  <td className={td + " text-right"}>
                    {k.revokedAt ? (
                      <Badge>Revoked</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-bad" onClick={() => revoke(k)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
