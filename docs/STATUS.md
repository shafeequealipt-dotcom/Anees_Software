# Build status

**Read this file before starting any work session. Update it before ending one.**

This tracks where the billing app build stands: what's done and verified, what's
half-built, what's not started, decisions already made, and bugs already found and
fixed (so they don't get "fixed" again or reintroduced). It exists because the
person who owns this app doesn't write code — this file is the source of truth for
what to do next, not their memory of a conversation.

Repo: https://github.com/shafeequealipt-dotcom/Anees_Software (public)
Plan doc (features/roadmap): https://claude.ai/artifact/1kh1d3yQiSi8Hx2zi6CufR

---

## How to use this file

**Before starting work:**
1. Read this whole file.
2. Run `npm run typecheck && npm test` to confirm the last session's state is still good.
3. Pick the next item from "Not started", top to bottom within the current phase.

**Before ending a session:**
1. Move finished items from their section into "Done" with a one-line note.
2. Add anything newly discovered to "Known issues" or "Decisions" as it happens, not
   as a batch at the end.
3. Commit and push. Update the "Last updated" line and commit hash below.
4. Leave "Not started" accurate — don't let it drift from what's actually in `src/`.

**Conventions to follow (don't rediscover these):**
- Money: integer paise. Quantity: integer thousandths ("milli"). Percent: integer
  basis points. See `src/lib/money.ts`. Never use floats for money.
- Server code that touches the database lives in `src/server/*.ts`, imported only by
  Server Components and Server Actions (`src/app/actions/*.ts`). Never import
  `src/server/*` or `src/db/*` from a Client Component.
- Every mutation goes through a Server Action in `src/app/actions/`, which calls
  `assertUser(permission)` first, then a function in `src/server/`, which does the
  real work inside `db.transaction()`.
- Every user-facing error is a `VoucherError` / `MasterError` / `AuthError` with a
  plain-language message — no stack traces or codes shown to the owner or staff.
- Full feature list and phases (P1–P4) are in the plan doc linked above, not
  duplicated here. This file tracks *build* status, the plan doc tracks *scope*.

---

## Last updated

2026-09-21 · session: full feature list built (119 tests pass). Settings, users, roles and multi-company are LIVE; the rest (PDF, Excel, accounting, messaging, price lists, etc.) is committed but NOT yet deployed

---

## Done (built and verified)

Verified = automated test passes, or manually clicked through in the dev server.

### Core logic (38 automated tests passing, `npm test`)
- [x] Money/quantity/percent helpers, Indian-format currency display — `src/lib/money.ts`
- [x] GST tax engine: CGST/SGST split, IGST, cess, line + bill discounts, tax-inclusive
  pricing, round-off — `src/lib/gst/engine.ts` (verified against hand-checked cases)
- [x] GSTIN validation with real check-digit math — `src/lib/gst/gstin.ts`
- [x] Amount-in-words (Indian numbering: lakh/crore) — `src/lib/amount-in-words.ts`
- [x] Voucher → ledger posting rules for all 15 voucher types (party/money/stock
  ledgers) — `src/lib/posting.ts`
- [x] Database schema: firms, users, sessions, parties, items, accounts, vouchers,
  voucher_lines, the three ledgers, allocations, audit_log, backup_runs,
  share_links — `src/db/schema.ts`, migration generated in `drizzle/0000_initial.sql`

### Server (business logic, transactional)
- [x] `saveVoucher` / `cancelVoucher` / `deleteVoucher` / `getVoucher` — full
  create/edit/cancel/delete for every voucher type, with numbering, tax calc,
  ledger posting, bill settlement (oldest-first or manual allocation), stock
  warnings — `src/server/vouchers.ts`
- [x] `saveParty` / `deleteParty` / `saveItem` / `deleteItem` / accounts / units /
  tax rates / categories — `src/server/masters.ts` (delete = deactivate if the
  record has history, hard-delete otherwise)
- [x] First-run setup (`runFirstSetup`) + default tax rates/units/categories seed
  — `src/server/setup.ts`
- [x] Reports as raw SQL for speed: dashboard, party balances + statement, stock
  summary + item movements, account statement, day book, profit & loss,
  item-wise sales, global search — `src/server/reports.ts`
- [x] End-to-end integration test against a real (embedded) Postgres: setup →
  parties/items → sale with part payment → IGST sale → payment settling oldest
  bill first → purchase → sale return → edit → cancel → transfer → stock
  adjustment → reports all agree — `tests/books.test.ts`, 11 scenarios

### Auth & security
- [x] Sessions (12h, 2h idle timeout), Argon2 passwords, login lockout (5 fails/
  account, 30 fails/IP), TOTP two-step login — `src/lib/auth.ts`
- [x] **Roles are now data (2026-09-20)**: `roles` table (migration `0002`), each role = a list of ticked
  permissions; built-in Owner (all, locked), Accountant, Billing staff (editable), plus custom roles.
  Catalog in `src/lib/permissions.ts` (`PERMISSION_GROUPS`): actions, screens, and **field visibility**
  (`see.purchasePrice`, `see.stockValue`, `see.partyBalance`, `see.partyContact`). `can(user, key)`.
  Enforced server-side (data is not sent to the browser when hidden) on: items list/detail/edit/report,
  parties list/detail/edit, dashboard, voucher & payment forms, global search; hidden fields are preserved
  on save by the server actions. Bills still carry the party address/GST no. (needed on invoices).
- [x] **Admin portal (2026-09-20)** `/settings/*` (was 404): Business details, Users (add, edit, role,
  deactivate, reset password; last-owner and self-lockout guards), Roles & access (permission checklist),
  Tax rates, Units, Activity log. `/account`: change own password; users with a temporary password are
  forced to choose their own before anything else (also blocked in server actions).
  Files: `src/server/admin.ts`, `src/app/actions/admin.ts`, `src/components/{business,user,role,change-password}-form.tsx`,
  `master-lists.tsx`, `settings-tabs.tsx`, tests `tests/admin.test.ts`
- [x] Audit log on every create/update/delete/cancel/login — `src/lib/audit.ts`

### Screens (clicked through in dev server, working)
- [x] Login, TOTP code entry, first-run business setup — `src/app/(auth)/`
- [x] App shell: sidebar nav, global search (Ctrl+K), user menu — `src/components/nav.tsx`,
  `search.tsx`, `src/app/(app)/layout.tsx`
- [x] Home dashboard: receivable/payable/cash tiles, 12-month sales chart, this-month
  summary, overdue invoices, cash & bank balances — `src/app/(app)/page.tsx`
- [x] **Generic voucher list/new/edit/view** — one set of pages
  (`src/app/(app)/[section]/...`) drives all 11 line-item + payment voucher types
  (sales, purchases, returns, quotations, orders, challans, expenses, other
  income, stock adjustments) via `[section]` → `typeFromPath()`. Don't build
  per-type pages; extend these generic ones.
  - [x] `VoucherForm` (`src/components/voucher-form.tsx`) — item lines, tax,
    discounts, party picker with quick-add, payment capture. **Known-working**
    after the two bugs below were fixed.
  - [x] `PaymentForm` / `MoneyForm` (`src/components/payment-form.tsx`) — receive/
    make payment with bill settlement, cash/bank adjustment, transfers
  - [x] Voucher detail view + actions (edit/cancel/delete/convert/share) —
    `src/app/(app)/[section]/[id]/page.tsx`, `src/components/voucher-actions.tsx`
- [x] Parties: list (with filters), add/edit form, detail page with statement —
  `src/app/(app)/parties/`
- [x] Items & stock: list (search, category filter, low/inactive tabs), add/edit
  form (pricing, tax, units incl. alternate unit, batch/serial toggles, opening
  stock), detail page with stock movement history and low-stock indicator —
  `src/app/(app)/items/`, `src/components/item-form.tsx`
- [x] Cash & bank: account list with live balances, add/edit bank account form,
  account statement page (linked vouchers, running balance, print) —
  `src/app/(app)/cash-bank/`, `src/components/account-form.tsx`

- [x] Reports: landing page, day book, profit & loss (trading + P&L account,
  expense/income by category), stock summary, low stock, item-wise sales/
  purchases, tax report (by GST rate, output vs input) —
  `src/app/(app)/reports/`, `taxReport()` added to `src/server/reports.ts`

### Multiple companies (built 2026-09-20, migration `0003_multi_company.sql`)
- [x] One database, many companies. Every master (parties, items, categories, party groups, cash/bank
  accounts, tax rates, units, ledger categories, settings) and every bill belongs to a company (`firm_id`);
  bill numbers restart per company; same party/item names allowed in two companies. Each company has its own
  country, so one can be India (₹, GST) and another Saudi (SAR, VAT).
- [x] Convention: every firm-scoped server function takes `firmId` as its **2nd argument** (`fn(db, firmId, ...)`);
  pages/actions pass `user.firmId`. By-id pages/actions filter on `firm_id`, so another company's record 404s.
  Reports/dashboard/search/form loaders all filter by company. Tests: `tests/admin.test.ts` › "multiple companies".
- [x] Access: owners open every company; other roles only the companies ticked on the user (`user_firms`).
  The chosen company is stored on the session (`sessions.firm_id`); header switcher (`company-switcher.tsx`),
  `/no-access` page for users with none. Settings → Companies (`companies.manage` permission): add / hide.
  Settings → "This company" edits the open company. Extra companies get their own seeded tax rates, units, cash account.
- **Known limitation:** the display region (currency/tax wording) is a module-level value on the server, set per
  request from the company's country. Two people working at the same instant in companies of *different*
  countries could rarely see the other's currency symbol on one render. Fix before printing invoices: pass the
  region explicitly (the PDF work should do this).
- Not built: a combined view across companies; copying items/parties between companies.

### Production (live)
- [x] **Deployed 2026-09-19** to the shared Oracle VM (Ubuntu 22.04, 2 vCPU, ~1 GB RAM) at
  `https://billing.dnhcare.co.in`. Valid Let's Encrypt certificate (webroot method,
  auto-renews), HTTP→HTTPS redirect, `/api/health` OK, first-run `/setup` page reachable.
- [x] **This server is shared** with the owner's other sites (nginx + Certbot own 80/443)
  and a live trading bot. So this host uses the *shared-nginx* topology, not Caddy:
  `deploy/docker-compose.shared-nginx.yml` (app on 127.0.0.1:8091 only, small Postgres
  settings) and `deploy/server/billing-shared-nginx.sh` (installed as `/usr/local/bin/billing`).
  **Never run `setup-server.sh` or `billing.sh deploy` on this host.**
- [x] nginx site: `/etc/nginx/sites-available/billing.dnhcare.co.in` (ACME webroot
  `/var/www/letsencrypt`, same as the owner's other sites). DNS: A record `billing` → 68.233.109.57 (GoDaddy).
- [x] systemd timers installed (nightly snapshot, health check every 10 min, weekly PITR/verify;
  PITR jobs no-op until OCI keys exist). `sudo billing setup-link` prints the one-time owner-setup link.

### Deployment (written; standalone-VM path never run)
- [x] `docker-compose.yml`, Caddy (HTTPS), app + db Dockerfiles — `deploy/`
- [x] PostgreSQL image with pgBackRest continuous backup to Oracle Object Storage
  — `deploy/postgres/`
- [x] Encrypted nightly snapshot → Oracle Object Storage + Google Drive, weekly
  test-restore, yearly archive, restore scripts — `deploy/backup/`
- [x] `billing.sh` ops command (status/deploy/snapshot/pitr/restore-time/
  recovery-copy/healthcheck), `setup-server.sh` one-time VM prep, systemd timers
  — `deploy/server/`
- [x] `deploy/push.sh` — build from the Mac, rsync to VM, deploy

### Dev tooling
- [x] Vitest test suite (`npm test`), TypeScript strict mode (`npm run typecheck`),
  embedded PostgreSQL for local dev with no Docker (`@electric-sql/pglite`) so
  the app runs with `npm run dev` and no database server installed
- [x] Demo data seeder (`src/server/demo.ts`, `/api/dev` route, dev-only) — one
  fictional business (Sharma Stationery Mart) with realistic parties, items,
  and a full month of transactions, for manually testing screens

---

## In progress

*(nothing mid-way right now — pick up "Not started" below)*

---

## Region support (India + Saudi Arabia) — added 2026-09-19
- Country is chosen at first-run setup and stored on the firm (`firms.country`: `IN` | `SA`). `src/lib/region.ts`
  holds everything that differs (currency, tax name, tax-ID label, states, HSN, digit grouping, time zone,
  financial-year start). Server loads it per request (`src/server/region.ts`), a tiny client component
  (`RegionInit`) sets it in the browser.
- **GST/VAT number and state are optional.** No number ⇒ business is "unregistered" ⇒ no tax charged.
- Saudi Arabia: VAT 15% / zero-rated / exempt / out-of-scope; single VAT shown (stored in the `igst` column);
  SAR with 1,234,567.89 grouping; 15-digit VAT-number check (starts and ends with 3); amount in words in
  riyals/halalas; calendar financial year; Asia/Riyadh time; no HSN, no state/place-of-supply; **ZATCA Phase 1 QR**
  on sale invoices and credit notes (`src/lib/zatca.ts`).
- **Not done for Saudi Arabia:** ZATCA Phase 2 (Fatoora integration: signed UBL XML, cryptographic stamp,
  clearance/reporting — needs onboarding certificates); Arabic/bilingual invoices and RTL screens (invoice PDF is
  not built yet — build it bilingual); Hijri dates; zakat reports. Update migration: `drizzle/0001_country_and_optional_state.sql`.

## Feature list from the owner (Vyapar paid-plan features) — built 2026-09-20/21

All items below are **built, tested (119 automated tests) and pushed; not yet deployed to the server** unless a line says so.

| Feature | Status | Where |
|---|---|---|
| Sync across devices | Already true (one cloud DB) | — |
| Multiple companies | Built + deployed | header switcher, Settings → Companies |
| Invoice PDF, print, download, public share page | Built | `src/server/pdf/`, `/api/vouchers/[id]/pdf`, `/share/[token]` |
| Excel import/export (parties, items, bills, statements) | Built | `src/server/excel.ts`, `imports.ts`, `/parties/import`, `/items/import` |
| Bulk update of items | Built (export → edit → import; blanks unchanged) | `/items/import` |
| Restore deleted transactions (unlimited) | Built | soft delete + `/deleted` (`vouchers.restore`) |
| Multiple prices per item, per-party rates | Built | Settings → Price lists; item page; party page (`src/lib/pricing.ts`) |
| Credit limit | Built (off / warn / block) | Settings → Billing |
| Combine orders/challans into one sale | Built | `/sales/combine`, `voucher_sources` |
| Custom fields for items | Built (forms, Excel, printed invoices) | Settings → Item fields |
| Profit on invoice, bill-wise & party-wise profit | Built (`see.profit`) | `/reports/profit` |
| Item batch and serial report | Built | `/reports/batches`, `/reports/serials` |
| Accounting module (chart of accounts, journals, ledgers, trial balance, balance sheet) | Built | `/accounting`, `src/lib/gl.ts`, `src/server/gl.ts` |
| Fixed assets (depreciation, sale/scrap) | Built | `/accounting/assets` |
| Expenses with input tax credit | Built | tick box on expense form; tax report includes claimable expenses |
| TCS / TDS on bills (India) | Built (turn on in Settings → Billing) | bill form, `/reports/tds-tcs` |
| E-way bill | Built as a JSON file to upload on the GST portal (no live API) | bill page → E-way bill panel, `src/lib/eway.ts` |
| WhatsApp / email sending | Built engine; **works only after keys are set on the server** | `src/server/notify/`, Settings → Messages |
| Payment reminders (automatic) | Built; needs the scheduler (below) | Settings → Messages |
| Message to self / message to party on change | Built | Settings → Messages |
| Service reminders | Built | item field "service reminder", `/services` |
| Remove ads from invoices | Not applicable | — |

### To switch messaging and reminders on (server side, once)
Add to `/opt/billing/.env`, then `sudo billing deploy` (or restart the app): `CRON_SECRET=<long random>`;
for WhatsApp `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (and optionally `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`);
for email `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Install the timer:
copy `deploy/server/systemd/billing-notify.timer` to `/etc/systemd/system/`, `systemctl enable --now billing-notify.timer`.
Without WhatsApp keys, messages wait as "Tap to send" in Settings → Messages (wa.me links) — nothing is lost.

### Known limits of the new features
- Accounting uses the periodic stock method: stock on hand is valued from stock records and added on the balance sheet, not held in a ledger account. Rounding differences go to a "Round off" account.
- E-way bill: file for portal upload only; no direct GSP/API generation.
- WhatsApp Business API needs a Meta-verified number; business-initiated messages need an approved template.
- TDS is taken on the amount before tax; TCS on amount plus tax. Confirm with the accountant.
- Arabic / bilingual invoice text and ZATCA Phase 2 are still not built.
- Multi-company region race (see "Multiple companies") is avoided in PDFs/share pages (formatted in one synchronous block) but still exists for on-screen formatting.

## Not started

Ordered roughly by what go-live needs first. Check the plan doc for the full
feature list each of these maps to.

### Invoice PDF & sharing
- [ ] PDF generation (`@react-pdf/renderer` is already a dependency) — at least
  one clean layout, A4, with logo/bank details/QR/amount-in-words
- [ ] `/api/vouchers/[id]/pdf` route (referenced by `VoucherActions` already,
  doesn't exist yet)
- [ ] Share link page (`/share/[token]`) — public, no login, shows/downloads one
  invoice (`shareLinks` table + `shareLinkAction` already exist)

### Excel import/export
- [ ] `/api/export/vouchers` route (referenced by the voucher list page already)
- [ ] `/api/export/party-statement` route (referenced by party page already)
- [ ] Party import from Excel
- [ ] Item import from Excel

### Settings
- [x] Business details, staff users, roles & field visibility, tax rates, units, activity log — DONE 2026-09-20
- [ ] Logo/signature upload
- [ ] Invoice appearance settings
- [ ] Expense/income categories and item categories management screens
- [ ] Per-voucher-type numbering prefixes, invoice/quotation terms, other `settings` keys
- [ ] Backups page (status, manual snapshot trigger, download — owner only)

### My account
- [x] Change password (done 2026-09-20)
- [ ] Turn on/off two-step login (TOTP), shows QR code (`newTotpSecret`,
  `totpUri` already exist in `src/lib/auth.ts`)

### Data migration
- [ ] Read a Vyapar backup file and map it into this schema (design not started)

### Production readiness
- [x] Production build (`next build`) passes locally (2026-09-20)
- [ ] **Owner creates their login** at the setup link (`sudo billing setup-link`) — not done yet
- [ ] **Backups not proven yet.** Needs: owner's `age` public key at `/opt/billing/secrets/backup-recipients.txt`
  (owner keeps the private key), Oracle Object Storage keys + buckets, optional Google Drive. A first
  `sudo billing snapshot` attempt on 2026-09-19 stalled while building the backup image on the
  low-RAM host; re-try it when the server is quiet, and confirm a test restore.
- [ ] Decide long-term home: ~1 GB shared RAM is tight (image builds take 30–60 min and made SSH
  time out once). A larger dedicated VM is the safer option.
- [ ] Owner-facing backup & restore guide (plain language, for `docs/`)

---

## Known issues

Bugs found during building/testing this session, already fixed — noted so they
don't get reintroduced or "found" again.

1. **Opening balance date defaulted to today** instead of the start of the
   financial year, which put it *after* earlier-dated transactions in party/
   account statements. Fixed: `defaultOpeningDate()` in `src/server/masters.ts`
   now defaults to 1 April of the current FY.
2. **Hydration mismatch on the voucher form** — line row `key`s were generated
   with a module-level incrementing counter, which produced different values on
   the server render vs. the browser render (React remount). Fixed: initial
   lines now key off their array index (`i0`, `i1`, ...), only lines added
   client-side after the first paint get a random key.
3. **Focus didn't move to the quantity field fast enough** after picking an item
   in the invoice line combobox, so fast typists could type into the wrong box.
   Fixed in `pickItem()` in `voucher-form.tsx` — focus + select happens
   synchronously now, not in a `setTimeout`.

4. **Opening stock read as ₹0 in the Profit & Loss report** whenever an item's
   opening-stock date fell on the same calendar day as the report's `from` date
   — which is the common case, since items default their opening date to the
   financial year's start, the same date most P&L reports start from. The old
   `stockValueAt(addDays(from, -1))` excluded anything dated `from` itself,
   including the opening-balance entry, so its value silently fell into cost of
   goods sold instead, understating opening stock and overstating COGS by the
   same amount for the whole year. Found by clicking through the new P&L report
   against seeded demo data (opening stock showed ₹0 despite items clearly
   having opening quantities) before this was ever pushed. Fixed: added
   `stockValueAtStartOf()` in `src/server/reports.ts`, which treats an
   opening-balance ledger row (`source = 'opening'`) dated on `from` as
   belonging to the start of that day, while still excluding same-day vouchers
   (sales/purchases/adjustments) that happen only once the period is under way.
   Regression test: `tests/books.test.ts` → "counts opening stock dated on the
   financial-year start as opening, not as a same-day purchase".

5. **BuildKit killed the app image build near the end on the low-RAM server** (session
   healthcheck "only one connection allowed"). Workaround: build with `DOCKER_BUILDKIT=0`
   (built into `billing-shared-nginx.sh deploy`). Build takes ~1 hour there.
6. **Certbot `--nginx` got a 404 from the app** for the ACME challenge because `/` is proxied.
   Fix: explicit `/.well-known/acme-challenge/` location with the shared webroot, then
   `certbot certonly --webroot`.
7. Don't `pkill -f <pattern>` over SSH when the pattern is in the command itself — it kills the session.

Nothing currently open/unfixed.

---

## Decisions

Choices made that aren't obvious from the code, so they don't get re-litigated.

- **Single business, not multi-tenant SaaS.** No "organization" concept. One
  `firms` row is marked `is_default`. If a second firm is ever needed, that's a
  deliberate P3 feature (see plan doc), not the default architecture.
- **Generic voucher pages, not per-type pages.** All 11 line-item voucher types
  (sale invoice, purchase bill, quotation, etc.) share one list/new/edit/view
  route under `[section]`. Resist the urge to fork these into separate pages —
  extend `VOUCHER_INFO` in `src/lib/voucher-types.ts` instead.
- **Embedded Postgres for local dev** (`@electric-sql/pglite`), real Postgres in
  production (`DATABASE_URL` env var switches between them in `src/db/index.ts`).
  Keeps local development possible with zero installed services.
- **Clean-room only.** Never re-open or reference the original Vyapar app files
  when building a feature. Work from the plan doc's feature list and public GST
  rules only. (The original zip was analyzed once, then deleted — see
  `[[billing-app-project]]` memory.)
- **GitHub repo is public.** Flagged to the owner before the first push; they
  chose to keep it public. No real secrets are ever committed — deploy secrets
  are generated fresh on the server by `setup-server.sh`, never checked in.
  `deploy/env.example` holds placeholders only.
- **Deploy key per repo.** GitHub deploy keys are scoped to one repo each. This
  repo's push key is `~/.ssh/anees_software_deploy` on the owner's Mac, aliased
  as SSH host `github-anees-software` in `~/.ssh/config`. A different key
  (`talalhomeo_deploy`) exists on the same Mac for an unrelated project — don't
  reuse it here.
