"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getProductionAction, retryInvoiceAction, runChecksAction, saveProfileAction, setEnabledAction, startOnboardingAction } from "@/app/actions/zatca";
import { formatDateTime } from "@/lib/dates";
import { Alert, Badge, Button, Field, Input, Panel, Select, Table, td, th } from "./ui";

interface Settings {
  environment: "sandbox" | "simulation" | "production";
  status: string;
  enabled: boolean;
  crn: string;
  branchName: string;
  businessCategory: string;
  shortAddress: string;
  street: string;
  building: string;
  district: string;
  city: string;
  postal: string;
}

interface CheckResult {
  label: string;
  ok: boolean;
  status: number;
  messages: string[];
}

const ENV: Record<string, string> = { sandbox: "Sandbox (testing, developer portal)", simulation: "Simulation (rehearsal)", production: "Production (real invoices)" };
const STATUS: Record<string, { tone: "good" | "warn" | "bad" | "brand"; text: string }> = {
  pending: { tone: "warn", text: "Waiting to send" },
  reported: { tone: "good", text: "Reported" },
  cleared: { tone: "good", text: "Cleared" },
  rejected: { tone: "bad", text: "Rejected" },
};

export function EInvoicingPanel({
  hasVat,
  settings,
  lastCheck,
  certificate,
  invoices,
}: {
  hasVat: boolean;
  settings: Settings;
  lastCheck: { at: string; results: CheckResult[] } | null;
  certificate: { validTo: string; subject: string } | null;
  invoices: { id: number; voucherId: number; icv: number; kind: string; status: string; error: string | null; at: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState(settings);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checks, setChecks] = useState<CheckResult[] | null>(lastCheck?.results ?? null);
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setV((x) => ({ ...x, [k]: val }));

  async function act(name: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setBusy(name);
    setMsg(null);
    const r = await fn();
    setBusy(null);
    setMsg(r.ok ? (ok ? { ok: true, text: ok } : null) : { ok: false, text: r.error ?? "Something went wrong." });
    router.refresh();
    return r;
  }

  const saved = settings.crn !== "";
  const step = settings.status === "production" ? 4 : settings.status === "compliance" ? (checks?.length && checks.every((c) => c.ok) ? 3 : 2) : saved ? 1 : 0;
  const box = "grid gap-4 sm:grid-cols-2";

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warn">
        <strong>Read this first.</strong> ZATCA e-invoicing (Phase 2) is built to ZATCA&apos;s published technical rules, but it has not yet been tested against ZATCA&apos;s own servers. Do the steps below in the <strong>Sandbox</strong> first: ZATCA itself checks every sample invoice and tells you exactly what
        is wrong. Only move to Production after all checks pass and your accountant has confirmed the set-up. Once e-invoicing is on, saved invoices cannot be edited or deleted; you correct them with a credit note.
      </Alert>
      {!hasVat && <Alert tone="bad">Add your VAT number under Settings → This company before starting.</Alert>}
      {msg && <Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert>}

      <Panel title={`1. Company details for ZATCA ${step > 0 ? "✓" : ""}`}>
        <div className={box}>
          <Field label="Environment" hint="Start with Sandbox.">
            <Select value={v.environment} onChange={(e) => set("environment", e.target.value as Settings["environment"])} disabled={settings.status !== "not_started"}>
              {Object.entries(ENV).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Commercial registration number (10 digits)">
            <Input value={v.crn} onChange={(e) => set("crn", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" />
          </Field>
          <Field label="Branch or device name" hint="e.g. Riyadh Main Branch">
            <Input value={v.branchName} onChange={(e) => set("branchName", e.target.value)} />
          </Field>
          <Field label="Business activity" hint="e.g. Supply activities, Restaurants, Retail">
            <Input value={v.businessCategory} onChange={(e) => set("businessCategory", e.target.value)} />
          </Field>
          <Field label="Short national address" hint="4 letters + 4 digits, e.g. RRRD2929">
            <Input value={v.shortAddress} onChange={(e) => set("shortAddress", e.target.value.toUpperCase().slice(0, 8))} className="font-mono uppercase" />
          </Field>
          <Field label="Street">
            <Input value={v.street} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <Field label="Building number (4 digits)">
            <Input value={v.building} onChange={(e) => set("building", e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" />
          </Field>
          <Field label="District">
            <Input value={v.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={v.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Postal code (5 digits)">
            <Input value={v.postal} onChange={(e) => set("postal", e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" />
          </Field>
        </div>
        <div className="mt-3">
          <Button variant="primary" disabled={!!busy || !hasVat} onClick={() => act("profile", () => saveProfileAction(v), "Saved.")}>
            {busy === "profile" ? "Saving…" : "Save details"}
          </Button>
        </div>
      </Panel>

      <Panel title={`2. Get the certificate ${step > 1 ? "✓" : ""}`}>
        <p className="text-sm text-muted">
          In ZATCA&apos;s Fatoora portal (fatoora.zatca.gov.sa) choose &ldquo;Onboard new solution unit / device&rdquo; and copy the 6-digit one-time code. Enter it here within a few minutes. The app creates its own secret key on the server (stored encrypted; nobody types or sees it) and trades the code for a certificate.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <Field label="One-time code">
            <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" className="w-32 font-mono" placeholder="123456" />
          </Field>
          <Button variant="primary" disabled={!!busy || !saved || otp.length !== 6} onClick={() => act("otp", () => startOnboardingAction(otp), "Certificate received from ZATCA.")}>
            {busy === "otp" ? "Contacting ZATCA…" : settings.status === "not_started" ? "Get certificate" : "Get a new certificate"}
          </Button>
        </div>
        {certificate && (
          <p className="mt-2 text-xs text-muted">
            Certificate: {certificate.subject}. Valid until {certificate.validTo}.
          </p>
        )}
      </Panel>

      <Panel title={`3. ZATCA checks sample invoices ${step > 2 ? "✓" : ""}`}>
        <p className="text-sm text-muted">The app sends six sample invoices (standard and simplified: invoice, credit note, debit note). All six must pass.</p>
        <div className="mt-3">
          <Button variant="primary" disabled={!!busy || settings.status === "not_started" || settings.status === "csr_ready"} onClick={async () => {
            const r = await act("checks", async () => {
              const res = await runChecksAction();
              if (res.ok) setChecks(res.results);
              return res;
            });
            void r;
          }}>
            {busy === "checks" ? "Checking with ZATCA…" : "Run the checks"}
          </Button>
        </div>
        {checks && (
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {checks.map((c) => (
              <li key={c.label}>
                <span className={c.ok ? "text-good" : "text-bad"}>{c.ok ? "✓" : "✗"}</span> {c.label}
                {!c.ok && c.messages.length > 0 && <div className="ml-5 whitespace-pre-line text-xs text-bad">{c.messages.join("\n")}</div>}
                {c.ok && c.messages.length > 0 && <div className="ml-5 text-xs text-muted">{c.messages.join(" · ")}</div>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`4. Switch e-invoicing on ${settings.enabled ? "✓" : ""}`}>
        {settings.status === "production" ? (
          <div className="flex items-center gap-3">
            <Badge tone={settings.enabled ? "good" : "warn"}>{settings.enabled ? "On: new invoices and credit notes are sent to ZATCA" : "Paused"}</Badge>
            <Button disabled={!!busy} onClick={() => act("toggle", () => setEnabledAction(!settings.enabled))}>
              {settings.enabled ? "Pause" : "Switch on"}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">After all checks pass, ZATCA issues the production certificate. From then on every new sale invoice and sale return is signed, numbered in ZATCA&apos;s chain and sent automatically.</p>
            <div className="mt-3">
              <Button variant="primary" disabled={!!busy || !checks?.length || !checks.every((c) => c.ok)} onClick={() => act("prod", () => getProductionAction(), "E-invoicing is on.")}>
                {busy === "prod" ? "Contacting ZATCA…" : "Get production certificate and switch on"}
              </Button>
            </div>
          </>
        )}
      </Panel>

      {invoices.length > 0 && (
        <Panel title="Invoices sent to ZATCA" padded={false}>
          <Table>
            <thead>
              <tr>
                <th className={th}>No.</th>
                <th className={th}>Type</th>
                <th className={th}>When</th>
                <th className={th}>Status</th>
                <th className={th}>Details</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className={td + " num"}>{i.icv}</td>
                  <td className={td}>{i.kind === "standard" ? "Business (cleared)" : "Consumer (reported)"}</td>
                  <td className={td + " whitespace-nowrap text-muted"}>{formatDateTime(i.at)}</td>
                  <td className={td}>
                    <Badge tone={STATUS[i.status]?.tone ?? "neutral"}>{STATUS[i.status]?.text ?? i.status}</Badge>
                  </td>
                  <td className={td + " max-w-md text-xs text-muted"}>{i.error}</td>
                  <td className={td + " whitespace-nowrap text-right"}>
                    <a className="mr-2 text-sm text-brand-600 hover:underline" href={`/sales/${i.voucherId}`}>
                      Open
                    </a>
                    {i.status === "pending" && (
                      <Button size="sm" disabled={!!busy} onClick={() => act(`retry${i.id}`, () => retryInvoiceAction(i.id))}>
                        Send now
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
