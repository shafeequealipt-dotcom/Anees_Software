import type { ZatcaEnvironment } from "./csr";

/** ZATCA's Fatoora gateway. Only these addresses are ever called. */
const BASE: Record<ZatcaEnvironment, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

export interface ZatcaAuth {
  /** binarySecurityToken exactly as ZATCA returned it */
  token: string;
  secret: string;
}

export interface ZatcaResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T;
  /** Readable list of what ZATCA objected to (errors first, then warnings). */
  messages: { level: "error" | "warning" | "info"; text: string }[];
  networkError?: string;
}

function messagesOf(body: Record<string, unknown>): ZatcaResult["messages"] {
  const out: ZatcaResult["messages"] = [];
  const v = (body.validationResults ?? {}) as { errorMessages?: { code?: string; message?: string }[]; warningMessages?: { code?: string; message?: string }[]; infoMessages?: { code?: string; message?: string }[] };
  for (const [key, level] of [["errorMessages", "error"], ["warningMessages", "warning"], ["infoMessages", "info"]] as const) {
    for (const m of v[key] ?? []) out.push({ level, text: `${m.code ? `${m.code}: ` : ""}${m.message ?? ""}`.trim() });
  }
  const err = body.errors ?? body.message ?? body.error;
  if (out.length === 0 && err) out.push({ level: "error", text: typeof err === "string" ? err : JSON.stringify(err) });
  return out;
}

async function call(env: ZatcaEnvironment, method: "GET" | "POST", path: string, opts: { auth?: ZatcaAuth; otp?: string; clearance?: boolean; body?: unknown }): Promise<ZatcaResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "Accept-Version": "V2", "Accept-Language": "en" };
  if (opts.auth) headers.Authorization = `Basic ${Buffer.from(`${opts.auth.token}:${opts.auth.secret}`).toString("base64")}`;
  if (opts.otp) headers.OTP = opts.otp;
  if (opts.clearance !== undefined) headers["Clearance-Status"] = opts.clearance ? "1" : "0";
  try {
    const res = await fetch(`${BASE[env]}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(45_000) });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, body, messages: messagesOf(body) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return { ok: false, status: 0, body: {}, messages: [{ level: "error", text: `Couldn't reach ZATCA: ${msg}` }], networkError: msg };
  }
}

/** Step 1: swap a certificate request and the one-time code from the Fatoora portal for a compliance certificate. */
export const requestComplianceCsid = (env: ZatcaEnvironment, csrPem: string, otp: string) => call(env, "POST", "/compliance", { otp, body: { csr: Buffer.from(csrPem).toString("base64") } });

/** Step 2: ZATCA checks a sample invoice and says whether it would pass. */
export const checkComplianceInvoice = (env: ZatcaEnvironment, auth: ZatcaAuth, inv: { invoiceHash: string; uuid: string; xml: string }) =>
  call(env, "POST", "/compliance/invoices", { auth, body: { invoiceHash: inv.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(inv.xml).toString("base64") } });

/** Step 3: after the samples pass, ask for the production certificate. */
export const requestProductionCsid = (env: ZatcaEnvironment, auth: ZatcaAuth, complianceRequestId: string) => call(env, "POST", "/production/csids", { auth, body: { compliance_request_id: complianceRequestId } });

/** Simplified invoices (to consumers) are reported to ZATCA within 24 hours. */
export const reportInvoice = (env: ZatcaEnvironment, auth: ZatcaAuth, inv: { invoiceHash: string; uuid: string; xml: string }) =>
  call(env, "POST", "/invoices/reporting/single", { auth, clearance: false, body: { invoiceHash: inv.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(inv.xml).toString("base64") } });

/** Standard invoices (business to business) must be cleared by ZATCA before they are handed to the buyer. */
export const clearInvoice = (env: ZatcaEnvironment, auth: ZatcaAuth, inv: { invoiceHash: string; uuid: string; xml: string }) =>
  call(env, "POST", "/invoices/clearance/single", { auth, clearance: true, body: { invoiceHash: inv.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(inv.xml).toString("base64") } });

/** The certificate ZATCA returns is base64 of base64; turn it into a normal PEM. */
export function certificateFromToken(token: string): string {
  const inner = Buffer.from(token, "base64").toString("utf8").replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${inner.replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END CERTIFICATE-----\n`;
}
