#!/usr/bin/env node
/*
 * Talks to the billing app's bookkeeping API (/api/v1) for one company.
 *
 *   node scripts/books/api.mjs reference              → the company's accounts, parties, items… as JSON
 *   node scripts/books/api.mjs bills ["type=…&from=…"] → every matching bill (all pages) as JSON
 *   node scripts/books/api.mjs check  batch.json      → dry run: checks every entry, saves nothing
 *   node scripts/books/api.mjs post   batch.json      → dry run first; only if it's clean, saves for real
 *
 * The key comes only from the environment (never a file): BILLING_API_KEY_DNHCARE by default, or the
 * variable named by --key-env NAME. The address is https://billing.dnhcare.co.in unless BILLING_API_URL
 * or --url says otherwise. batch.json is { "entries": [ … ] } as described in docs/api.md.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const base = (flag("--url", process.env.BILLING_API_URL) || "https://billing.dnhcare.co.in").replace(/\/$/, "");
const keyEnv = flag("--key-env", "BILLING_API_KEY_DNHCARE");
const [cmd, file] = args;
const key = process.env[keyEnv];

function die(msg) {
  console.error(msg);
  process.exit(2);
}
if (!["reference", "bills", "check", "post"].includes(cmd)) die("Use: api.mjs reference | bills [query] | check <batch.json> | post <batch.json>  [--url URL] [--key-env NAME]");
if (!key) die(`${keyEnv} isn't set in this shell. It belongs in ~/.zshrc; open a new terminal (or launch from one) and try again.`);

async function call(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    die(`${res.status} from ${path}: ${text.slice(0, 300)}`);
  }
  if (res.status >= 400 && !data.results) die(`${res.status}: ${data.error ?? text.slice(0, 300)}`);
  return data;
}

const rupees = (p) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function report(out) {
  const counts = {};
  for (const r of out.results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  for (const r of out.results) {
    const dupes = r.possibleDuplicates?.length ? `  ⚠ looks like ${r.possibleDuplicates.map((d) => `${d.number} (${d.date}, ${rupees(d.amountPaise)})`).join(", ")}` : "";
    const what = [r.number, r.message].filter(Boolean).join(" — ");
    console.log(`${r.status.padEnd(15)} ${r.kind.padEnd(13)} ${r.ref}${what ? `  ${what}` : ""}${dupes}`);
  }
  console.log(`\n${out.dryRun ? "DRY RUN — nothing saved." : out.ok ? "SAVED." : "NOTHING SAVED (an entry failed)."}  ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
}

if (cmd === "reference") {
  console.log(JSON.stringify(await call("/api/v1/reference"), null, 2));
} else if (cmd === "bills") {
  const q = new URLSearchParams(file ?? "");
  q.set("limit", "1000");
  const bills = [];
  let page;
  do {
    q.set("offset", String(bills.length));
    page = await call(`/api/v1/bills?${q}`);
    bills.push(...page.bills);
  } while (page.bills.length && bills.length < page.total);
  console.log(JSON.stringify({ company: page.company, total: page.total, bills }, null, 2));
} else {
  if (!file) die("Give the batch file, e.g. batch-2026-09.json");
  const batch = JSON.parse(readFileSync(file, "utf8"));
  const entries = Array.isArray(batch) ? batch : batch.entries;
  const dry = await call("/api/v1/batch", { dryRun: true, entries });
  if (cmd === "check" || !dry.ok) {
    report(dry);
    process.exit(dry.ok ? 0 : 1);
  }
  const real = await call("/api/v1/batch", { dryRun: false, entries });
  report(real);
  process.exit(real.ok ? 0 : 1);
}
