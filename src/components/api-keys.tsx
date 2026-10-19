"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createApiKeyAction, revokeApiKeyAction, setApiEnabledAction } from "@/app/actions/api-keys";
import { Alert, Badge, Button, Field, Input, Panel, Select, Table, cx, td, th } from "./ui";

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

interface ApiEntry {
  id: number;
  firmName: string;
  label: string;
  number: string;
  link: string;
  date: string;
  party: string | null;
  amount: string;
  status: string;
}

export function ApiKeys({ keys, companies, offCompanies, currentFirmId, recent }: { keys: KeyRow[]; companies: { id: number; name: string }[]; offCompanies: string[]; currentFirmId: number; recent: ApiEntry[] }) {
  const router = useRouter();
  const [name, setName] = useState("Claude bookkeeping");
  const [firmId, setFirmId] = useState(companies.some((c) => c.id === currentFirmId) ? currentFirmId : (companies[0]?.id ?? 0));
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
          A key lets a program enter purchase bills, expenses, payments and transfers into one company only, through the app&apos;s usual checks. Everything it enters is recorded as made by the user <b>API</b>, and the activity log names the key. Keys can&apos;t delete anything or change settings.
        </p>
        {offCompanies.length > 0 && (
          <p className="mb-3 text-xs text-faint">
            API access is off for {offCompanies.join(", ")}. The Owner turns it on per company under Settings → Companies.
          </p>
        )}
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
        ) : companies.length === 0 ? (
          <Alert tone="brand">No company has API access turned on yet. Turn it on for a company under Settings → Companies first.</Alert>
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

      <Panel title="Entered through the API" padded={false}>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing yet. Everything a key enters shows up here, recorded as made by the user API.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Entry</th>
                <th className={th}>Company</th>
                <th className={th}>Date</th>
                <th className={th}>Party</th>
                <th className={th + " text-right"}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className={r.status === "active" ? "" : "opacity-60"}>
                  <td className={td}>
                    <a href={r.link} className="font-medium text-brand-600 hover:underline">
                      {r.label} {r.number}
                    </a>
                    {r.status !== "active" && <span className="ml-1.5 text-xs text-faint">{r.status}</span>}
                  </td>
                  <td className={td}>{r.firmName}</td>
                  <td className={td + " text-muted"}>{r.date}</td>
                  <td className={td}>{r.party ?? "—"}</td>
                  <td className={td + " num text-right"}>{r.amount}</td>
                </tr>
              ))}
            </tbody>
          </Table>
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

/** Owner-only switch on the Companies screen: whether API keys may be used for a company. */
export function ApiSwitch({ firmId, enabled }: { firmId: number; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", busy && "opacity-60")}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError(null);
            const res = await setApiEnabledAction(firmId, e.target.checked);
            setBusy(false);
            if (!res.ok) return setError(res.error);
            router.refresh();
          }}
        />
        <span>{enabled ? "On" : "Off"}</span>
      </label>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
