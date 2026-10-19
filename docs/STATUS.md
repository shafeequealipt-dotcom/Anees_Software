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

2026-09-29 · session: mobile UI scale + header overflow fix deployed. One-click Excel
data backup/restore built (203 tests pass); future feature list moved to
`docs/future-features.md`.

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

### Data backup (Excel) — built 2026-09-29
- [x] Settings → Backups → "Download all data (Excel)": one workbook, one sheet per
  business table (every company the person can open), a "Backup info" sheet with a
  format version and per-sheet row counts. `src/server/data-backup.ts`,
  `src/app/api/backup/excel/route.ts`, `src/components/excel-backup-panel.tsx`.
- [x] "Restore from Excel": checks the file, then adds every company in it as a
  **new** company (e.g. "Anees Shop (restored 29 Sept 2026)") in one transaction —
  existing companies and data are never touched. All rows are copied exactly (bill
  numbers, statuses, cancelled/deleted state) with fresh IDs; every foreign key,
  and the IDs hidden inside JSON (item custom-field values, deleted-bill snapshots,
  GL entry ref keys), are rewritten to the new IDs. A file with a missing/altered
  "Backup info" sheet or a row count that doesn't match what was recorded at export
  is rejected before anything is written.
- Deliberately excluded from the file (redone by hand after a restore, not copied):
  users/roles/logins, ZATCA device keys/certificates (redo onboarding), share
  links, backup job records.
- Requires nginx's `client_max_body_size` to allow files bigger than the 1 MB
  default on production — not yet applied there (see Not started).
- Round-trip tested (export → restore → same party balances, stock, day book,
  trial balance, invoice numbers/PDF, audit trail) in `tests/data-backup.test.ts`,
  and manually via the real Settings → Backups screen in the dev server.

### Staff & salaries — built 2026-09-30 (migration `0020_staff_salaries.sql`)
- [x] Accounts → Staff & salaries (`/staff`): monthly salary sheet per month — salary, extra pay /
  deductions (per employee per month, `salary_adjustments`), advances, paid, still due, with Pay and
  Advance buttons. Employee pages (`/staff/[id]`) with payment history; add/edit; "All staff" list incl.
  people who've left. `src/server/staff.ts`, `src/components/staff.tsx`, `src/app/actions/staff.ts`.
- [x] Every payment is an ordinary expense (category "Salaries & wages", found by name or recreated)
  tagged with `vouchers.employee_id / pay_month / pay_kind`, so cash, bank, P&L and the GL need nothing
  extra. Advances given in a month come off that month's salary. A salary payment can't exceed what's
  due (bonus goes under Extra first). Amounts are exact (no round-off).
- [x] Privacy: new permission `staff.manage` (Owner always; Accountant via the migration). Without it,
  salary entries are hidden from expense lists, day book, search, Excel export, and can't be opened
  (`canSeeVoucher`). Aggregate totals (P&L, dashboard) still include them.
- Not built: pro-rating for mid-month joiners/leavers (enter it as a deduction), PF/ESI/TDS on salary,
  payslips. Tests: `tests/staff.test.ts`.

### Company isolation — tightened 2026-10-02 (migration `0021_company_owner_role.sql`)
- Rule: only the **Owner** role works across companies. Everyone else sees and changes only the
  companies ticked on them — never another company's name, shops, accounts, people or activity.
- New built-in role **Company owner**: every permission except "Add and hide companies"; limited to
  its ticked companies. Roles are shared by all companies, so only an Owner can add/change roles
  (Roles & access tab and pages are owner-only).
- `src/server/admin.ts` functions take an `Actor` (the signed-in user): `listUsers`, `listCompanies`,
  `listAllLocations`, `listRoles` are scoped to it; `createUser`/`updateUser`/`resetUserPassword`
  refuse people outside the actor's companies (or shared with another company), refuse granting the
  Owner role or any role with permissions the actor lacks, and refuse giving another company's access
  or shop. A shop can only be assigned to someone who works in its company (even by an owner).
- Fixed leaks: Cash & bank list showed every company's accounts; Activity log showed every company
  (now this company only; company-less entries owner-only); Users/new-user form listed all users,
  companies and shops; server backup panel and "Back up now" now owner-only; the sign-in page no
  longer names a company when there are several; a bill save no longer sends other companies'
  queued messages. Party/item/account statements verify the record's company themselves.
- Tests: `tests/company-isolation.test.ts`; checked in the browser as a Company owner (every other
  company's record id → 404, its backup → 403, no trace on any list page).
- Known, not yet fixed: the display region (currency/tax wording, GSTIN vs VAT checks in `saveParty`
  / `saveFirm`) is a module-level value, so two people working at the same instant in an Indian and a
  Saudi company can briefly get each other's rules (see "Multiple companies" above).

### Product IDs — added 2026-10-08 (migration `0022_product_ids.sql`)
- Every product has a **Product ID** — the old optional "Item code" (`items.code`), now `NOT NULL` and
  unique per company **ignoring case** (index `items_code_lower_key` on `(firm_id, lower(code))`).
  There is no second ID field.
- Per company, Settings → Billing → "Product IDs": **Automatic** (the default; next number after the
  company's highest, optional prefix and minimum digits) or **Choose your own** (must be typed).
  Settings keys `productIdMode`, `productIdPrefix`, `productIdDigits`.
- Rules live in `saveItem` (`src/server/masters.ts`): it takes `pg_advisory_xact_lock('item:<firm>')`,
  so two saves can't get the same ID; a typed ID is accepted in both modes; an edit with a blank ID
  keeps the existing one. Only IDs of prefix + 1–9 digits count towards the sequence, so a barcode
  typed as an ID doesn't hijack it (`src/lib/product-id.ts`).
- Shown as **ID then name on one line** ("132 iphone bag") everywhere a product is named: use
  `productLabel()` for text and `<ProductName>` on screen. Bills look the ID up live
  (`getVoucher` lines carry `itemCode`; the invoice model's lines carry `code`, `desc` unchanged) —
  nothing is stored on `voucher_lines`, so changing a product's ID changes it on old bills too.
- Excel: items sheet heading is "Product ID" ("Item code" still read); the app's own row number is
  "Row ID (do not edit)" ("ID" still read). Restoring a backup made before this numbers any product
  without an ID and stops on two products sharing one.
- Deliberately unchanged: ZATCA XML, e-way bill JSON, and no scannable barcode images (see
  `docs/future-features.md`).
- Tests: `tests/product-id.test.ts` (includes running migration 0022 on live-shaped data).

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

### Built 2026-09-21 (second batch) — 146 tests pass
| Feature | Where |
|---|---|
| Logo and signature upload (kept in the DB, so backups include them) | Settings → This company; `/api/company/image`; table `firm_images` |
| Invoice styles Classic / Modern with accent colour; A4, A5, thermal 80 mm and 58 mm receipts | Settings → Billing; `?paper=t80` on the PDF URL; `src/server/pdf/invoice-pdf.tsx` |
| Bilingual (English + Arabic) or Arabic-only invoices; Arabic names on company, parties and items; Arabic amount in words | `src/lib/invoice-labels.ts`, `src/lib/arabic.ts`; fonts Noto Sans + Tajawal in `assets/fonts` (Noto Sans Arabic was rejected: it drops letter dots in this PDF library) |
| Arabic interface with right-to-left layout | header menu → العربية; `src/components/translator.tsx` swaps text using `src/lib/ui-ar.ts` (exact-match dictionary; extend it as needed); RTL CSS at the end of `globals.css` |
| Item, expense and income category management | Settings → Categories |
| Backups page with "Back up now" | Settings → Backups; table `backup_requests`; server job `billing backup-requests` + `deploy/server/systemd/billing-backup-requests.timer` (**must be installed on the server**) |
| ZATCA Phase 2 e-invoicing | Settings → E-invoicing (Saudi companies); `src/lib/zatca/*`, `src/server/zatca.ts` |

**ZATCA Phase 2 — read before use.** Implemented: device key (secp256k1, stored encrypted with APP_SECRET), certificate request (verified with OpenSSL), UBL 2.1 XML written in canonical form, invoice hash and chain (ICV/PIH), XAdES signature, Phase 2 QR (tags 1–9), onboarding (one-time code → compliance certificate → six sample checks → production certificate), reporting (consumer invoices) and clearance (business invoices) with retries, and locking of issued invoices (corrections by credit note). It is tested against a **pretend** ZATCA server only. It has **not** been run against ZATCA's real servers, so some details (digest formats, exemption reason codes, address rules) may need adjusting after the first Sandbox run; ZATCA's own validation messages are shown in the app. Debit notes (sales-side) are not created by the app yet. Buyers need the national address on the party for business invoices.

### Known limits of the new features
- Accounting uses the periodic stock method: stock on hand is valued from stock records and added on the balance sheet, not held in a ledger account. Rounding differences go to a "Round off" account.
- E-way bill: file for portal upload only; no direct GSP/API generation.
- WhatsApp Business API needs a Meta-verified number; business-initiated messages need an approved template.
- TDS is taken on the amount before tax; TCS on amount plus tax. Confirm with the accountant.
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

### Server config
- [ ] Add `client_max_body_size 50m;` to `/etc/nginx/sites-available/billing.dnhcare.co.in`
  (needed for the Excel backup/restore feature above; nginx's 1 MB default would
  reject a real backup file), then `nginx -t` and reload.

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

### Partners (OrpheusMedia only) — added 2026-10-08 (migration `0023_partners.sql`)
- Off by default. The **Owner** turns "Partners" on per company (Settings → Companies); until then the
  pages are "not found" and every action refuses. Permission `partners.manage` (Owner always; the
  built-in Company owner role gets it from the migration; custom roles tick it under Roles & access).
- `/partners` is the month sheet (like Staff & salaries): views → amount = views ÷ 10,00,000 × rate
  (whole rupees, correctable), promotions, total, paid, due. Onboarding at `/partners/new` (national or
  international bank fields). Rate per month is copied, so a later rate change never rewrites past months.
- Payments are ordinary expenses in a "Partner payments" category tagged `vouchers.partner_id` + `pay_month`;
  hidden from people without `partners.manage` (`canSeeVoucher`, the `hidePartners` filters in reports).
- Payout invoice: `src/server/pdf/payout-invoice-pdf.tsx` (Orpheus look; fonts Outfit / Playfair / Space Mono
  in `assets/fonts`, SIL OFL). Numbers `ORP/2026-27/001` (prefix from settings, April–March year, lock-protected).
  Payee details are copied onto the invoice when saved. Letterhead comes from Settings → This company plus the
  "Payout invoice settings" box on the Partners page (LLPIN, TAN, signer, usual rate/wording/notes).
- WhatsApp: the button opens WhatsApp Web on the partner's number with a message and a private 90-day link
  (`/api/share/payout/<token>/pdf`, no sign-in); on phones the PDF itself goes through the share sheet.
- Backup/restore carries partners, payouts and promotions (links excluded). Tests: `tests/partners.test.ts`.
- `/partners/overview`: how many partners there are and how the list has grown (`partnerGrowth` in
  `src/server/partners.ts`, charts in `src/components/partner-growth.tsx`): total / national / international /
  added this month, stacked columns of partners added per month, and a running-total line, last 12 months.
  A partner counts from `joined_on`, or the day they were added when that is blank.
- Pop-up boxes on the sheet (`Popover` in `src/components/staff.tsx`) take a `width` and, with `sheetOnPhone`,
  become a panel across the top on phones. The sheet's extra columns (For views, Paid, Invoice) show only at
  2xl; below that the invoice number sits under the partner's name, and the name column shrinks instead of
  the table overflowing.
- Not yet checked in a real browser: the WhatsApp button actually opening WhatsApp Web.
### Keyboard entry in multi-row grids — added 2026-10-14
- One helper, `src/lib/grid-keys.ts` (`gridKeyDown`, `focusCell`): on a grid marked with `data-row` rows and
  `data-cell="<column>"` fields, Enter / Shift+Enter move to the next / previous field, ↑ / ↓ move to the same
  column in the next / previous row (typed boxes only), and landing on a box selects its text. Tab / Shift+Tab
  are the browser's own; tick boxes and delete buttons have `tabIndex={-1}` so Tab goes column to column.
- Used on: bill lines (`voucher-form.tsx`, all line-item types; Enter past the last field of a typed line adds a
  line), payment allocations, journal lines (Enter past the end adds a line), item price lists, customer special
  rates, and receiving a stock transfer.
- Item picker (`combobox.tsx`): Tab now takes the highlighted product when the typed text clearly points at it
  (starts its name, is its code, the only match, or chosen with the arrows); otherwise typed text stays as the
  description. Enter on a description that matches nothing keeps it and moves on to Qty.

### Day-by-day sales & purchases — added 2026-10-14
- Report **Sales & purchases for the day** (`/reports/day-sales-purchases`, `daySalesPurchases` in
  `src/server/reports.ts`): every sale, sale return, purchase and purchase return of one day (today by
  default), totals (cancelled bills listed but not counted), per-shop limit like the bill lists (shop-bound
  users see their shops; owners pick one or all). Printed with the browser (Print button); the app frame is
  `print:`-styled so long reports run onto further pages and menus/buttons/filters don't print.
- **Sale invoices and Purchase bills open on today**, with a ‹ date › switcher (`src/components/day-nav.tsx`)
  and a link to print the day. The period menu still offers ranges. The Unpaid / Overdue views (linked from
  Reports and the home page) keep the whole financial year. Other bill lists are unchanged.
- `DailySalesFilters` now uses the same ‹ › day switcher (Daily sales report too). `PageHeader` back links
  and action buttons don't print.
- Tests: `tests/day-sales-purchases.test.ts`.
- `?show=sales` / `?show=purchases` / (none = both) picks what the day report shows and prints. Sale invoices link
  to the sales view, Purchase bills to the purchases view; Reports lists all three. A Sales / Purchases / Both
  switch on the page (not printed).

### Back button and Backspace — added 2026-10-14
- `src/components/back-nav.tsx` (`BackButton`, in the top bar of every page except Home): goes to the page you
  came from inside the app (a per-tab trail in sessionStorage, since the browser won't say whether the previous
  page was ours); with no such page it replaces the current page with its parent path (bill → list → Home).
- **Backspace** does the same when focus isn't in a box (in a box it deletes as usual; skipped while a modal
  dialog is open). If anything was typed on the page since it opened (not searches, the day switcher or list
  filters — marked `data-no-dirty`), it asks before leaving.
- Top bar left padding below `lg` now clears the fixed Menu button (it used to cover the start of the bar).

### Deleting staff and partners — added 2026-10-14 (migration `0024_people_delete.sql`)
- New permission `people.delete` ("Delete staff and partners"): the Owner always has it; the migration gives it to
  the built-in Company owner role only (Accountant and Billing staff don't get it; custom roles can be ticked).
- `deleteEmployee` (`src/server/staff.ts`) and `deletePartner` (`src/server/partners.ts`): anyone with payments
  (or, for partners, a payout invoice) on record is made inactive instead of deleted, so past entries and the books
  stay as they were; otherwise the record goes (with month notes / typed views and promotions).
- Delete button (`src/components/delete-person-button.tsx`) at the foot of the employee and partner pages, shown
  only to people with the permission. Tests: `tests/delete-people.test.ts`.

### Roles per company — added 2026-10-14 (migration `0025_company_roles.sql`)
- `roles.firm_id`: a custom role can belong to one company. Built-in roles and roles the Owner shares stay empty
  (every company sees them). Names are unique per company plus shared (`roles_name_firm_key` on
  `(coalesce(firm_id, 0), lower(name))`, and `saveRole` refuses a company name that matches a shared role).
- New permission `roles.manage` ("Manage roles for their companies"): Owner always; the migration gives it to the
  built-in Company owner role (and updates that role's description). The Roles & access tab needs it.
- `listRoles`: the Owner sees every role with its company; anyone else sees shared roles plus their companies' own,
  only those they could give, with user counts limited to people they can see. `saveRole` / `deleteRole`: a company
  owner creates and changes only their companies' roles (their only company is picked for them), never built-in
  or shared ones, and can't include a permission they don't hold. A company's role can only be given to people
  who work in that company (`assertGrantable`), even by the Owner.
- The migration moves each custom role whose holders all work in one company to that company (live: "Wholesale
  staff" → Anees_Shop); unused or multi-company custom roles stay shared ("Orpheus").
- Tests: `tests/company-isolation.test.ts` ("roles belonging to one company"), `tests/company-roles-migration.test.ts`.

### Bookkeeping API — added 2026-10-19 (migration `0026_api_keys.sql`)
- For entering a company's purchase bills, expenses, payments and transfers from documents without typing.
  Full reference: `docs/api.md`. Command line on the owner's Mac: `scripts/books/api.mjs` (reference / check /
  post; key only from the `BILLING_API_KEY_DNHCARE` environment variable).
- Keys: Settings → API keys (permission `api.manage`, Owner by default), one company each, shown once, stored as
  SHA-256 (`api_keys`, excluded from Excel backups), revocable; entries are made in the maker's name; ten bad
  keys per address per ten minutes → 429 (`src/server/api-key-auth.ts`, in memory).
- `GET /api/v1/reference`, `POST /api/v1/batch` (`src/server/api-v1.ts`): one transaction per batch, dry run by
  default, refs make bills/payments idempotent (`vouchers.external_ref`, unique per company), parties/items/bank
  accounts matched by GSTIN / Product ID / name, a purchase bill is refused if its total differs from the printed
  one, `relink` moves an existing expense or payment to another account (money ledger + books resynced), and
  look-alike hand-made entries are reported. Every batch is one Activity-log entry naming the key.
- **Per-company switch**: setting `apiEnabled` (Settings → Companies, Owner only). Keys can only be made for, and
  only work for, companies with it on (`verifyApiKey` returns "off" → 403).
- **API user** (`users.is_api`, migration `0027_api_user.sql`): made on first key by `ensureApiUser` (with a built-in
  no-permission "API" role, hidden from role pickers). Every API entry is created by it; it's deactivated, has no
  usable password, sign-in refuses it, it can't be edited or have a password set, and setup's user count ignores it.
  Bill lists tag its entries "API" (`by_api` in `listVouchers`), the bill page says "Created … through the API", and
  Settings → API keys lists the latest API entries. Batch audit entries name the key and who made it.
- Tests: `tests/api-v1.test.ts`.

### Telegram bill bot — added 2026-10-19 (migration `0028_telegram.sql`)
- The Owner sends a photo or PDF of a bill to the company's Telegram bot; the server reads it with a vision model
  (OpenRouter), shows a summary with buttons, and enters it only when the Owner taps Enter. Full notes:
  `docs/telegram.md`.
- Setup: Settings → Telegram (Owner only): bot token from @BotFather and an OpenRouter key, both sealed with
  `src/lib/secret-box.ts` in `telegram_config` and never shown again; saving checks the token (`getMe`) and the key,
  and registers `/api/telegram/webhook` with a random secret (only its SHA-256 is kept). Per-company setting
  `telegramEnabled`. "Link my Telegram" makes a one-time 10-minute code (`/start <code>`); only an active Owner
  can be linked (`telegram_links`, one company per chat, `/company` in the bot switches).
- Flow (`src/server/telegram/`): webhook answers at once and works in `after()`; update ids de-duplicated
  (`telegram_updates`). Photo/PDF → `telegram_drafts` + `telegram_files` (album = one draft) → `read-bill.ts` (AI
  transcribes, zod-checked) → `draft.ts` (supplier by GSTIN/name, items by Product ID/name, new ones as `party`/`item`
  entries; purchase bill with `expectedTotalPaise`, or an expense) → bookkeeping API dry run → summary.
  Buttons: Enter – not paid yet / paid from <account> (purchase bills; expenses only the paid-from ones) / Discard.
  A reply to the summary is a correction and re-reads. Enter is guarded ready → entering, so a double tap enters
  once; entries are made by the API user, ref `tg-<draft>`, audit "Via Telegram (sent by …)".
- Bill page: "Created … through Telegram" with View photo links (`/api/telegram/photo/[id]`, signed-in users who
  can see the bill). Settings → Telegram lists recent bills sent. Telegram tables are left out of Excel backups.
- API addition: `purchase_bill.paidFrom` (account) enters the bill fully paid from that account.
- Tests: `tests/telegram.test.ts` (Telegram and the AI faked).

- **Free reading (migration `0029_telegram_free_models.sql`)**: bills are first turned into text on the server
  (`src/server/telegram/ocr.ts`: pdftotext for text PDFs, Tesseract + sharp cleaning for photos/scans; both installed
  in `deploy/app.Dockerfile`), the text goes to a free OpenRouter text model, and the picture goes to a free vision
  model only when the bill doesn't add up or OCR confidence is low (`readDraft` in `webhook.ts`). Models are up to
  three ids per kind, tried in order via OpenRouter's `models` fallback; defaults are `:free` models, checked against
  OpenRouter's list when saved. The AI is only told about suppliers/items sharing a word with the bill
  (`candidates`), and the app matches names itself (`closest` in `draft.ts`). `sharp` is now a direct dependency.

### Staging environment and branches — added 2026-10-19
- Git: `main` = live, `develop` = where changes are made; GitHub check runs tsc + tests (`.github/workflows/test.yml`).
- Staging copy on the same server (`/opt/billing-staging`, project `billing-staging`, local port 8092, nginx site
  `billing-staging.dnhcare.co.in`): `deploy/docker-compose.staging.yml`, `deploy/server/billing-staging.sh`,
  `deploy/server/setup-staging.sh`, `deploy/push-staging.sh`. `src/components/staging-bar.tsx` shows the red bar
  when `APP_ENV=staging`. `deploy/push.sh` (live) now refuses unless on a pushed `main` whose exact content was
  deployed to staging. Full description: `docs/workflow.md`.
- **Cross-checking and robustness (migrations 0030, 0031)**: `reconcile.ts` repairs misread quantities/rates from the
  bill's own redundant numbers (MRP, discount %, line amount, subtotal, total quantity — new fields the AI is asked
  for) and reports every change; pack sizes become part of the item name; models are tried one by one, thinking is
  switched off for bill reading (retried with thinking allowed for models that insist), errors quote the service;
  a shrunk-photo hint suggests sending a File. Fixed: a typographic dash in the `X-Title` header made every
  reading fail; the default text model id was missing `-a12b`; linking also works with `/link <code>`.
