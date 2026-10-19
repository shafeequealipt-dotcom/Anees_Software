# Bookkeeping API (`/api/v1`)

For entering a company's purchase bills, expenses, payments and bank transfers from documents (supplier
bills, bank statements) without typing. Everything is saved through the same rules as the screens, so tax,
stock, ledgers and the books behave exactly as if the entry had been typed.

## Keys

First the Owner turns **API** on for the company under Settings → Companies (it's off for every company by
default; turning it off stops that company's keys straight away). Then Settings → **API keys** (Owner, or
anyone given "Manage API keys"). A key belongs to **one company**, is shown once, and only its SHA-256 is
stored. Everything it enters is recorded as made by the built-in user **API** (which can't sign in), tagged
"API" in the bill lists and listed under Settings → API keys; the Activity log records each batch with the
key's name and who made it. Revoke a key there; a key also stops working when
its maker is deactivated. Ten wrong keys from one address in ten minutes and that address waits.

Send it as `Authorization: Bearer bk_…` over HTTPS. On the owner's Mac the DNHCARE key lives only in
`~/.zshrc` as `BILLING_API_KEY_DNHCARE` (never in a file in the project).

## `GET /api/v1/reference`

The company's accounts (cash/bank), expense and income categories, parties (name, kind, GSTIN, phone,
state), items (Product ID, name, HSN, unit, GST %, purchase price), tax rates and shops — for matching
documents to existing records.

## `POST /api/v1/batch`

```json
{ "dryRun": true, "entries": [ { "kind": "…", "ref": "…", … } ] }
```

- **One transaction.** If any entry fails, nothing is kept (`ok: false`, HTTP 422). `dryRun: true` (the
  default) checks everything the same way and keeps nothing.
- **`ref`** is the caller's own unique key for the source line (`hdfc-2026-09-14-3`, `bill-MD-881`). A bill
  or payment whose `ref` was entered before is skipped (`already_entered`), so sending a batch twice is safe.
  Parties, items and bank accounts are matched by GSTIN / Product ID / name instead.
- Later entries refer to earlier ones by `ref`: `{ "ref": "sup-medi" }`. Existing records can be named by
  `id`, `name`, `gstin` (parties) or `code` (items).
- Money is in **paise** (whole numbers); quantities are plain numbers; dates are `YYYY-MM-DD`.
- At most 500 entries per batch.

### Entry kinds

| kind | fields |
|---|---|
| `bank_account` | `name`, `bankName?`, `accountNo?`, `ifsc?`, `openingBalancePaise`, `openingDate` |
| `party` | `name`, `partyKind` (`supplier`/`customer`/`both`), `gstin?`, `phone?`, `address?`, `stateCode?` (from the GSTIN if missing) |
| `item` | `name`, `code?` (Product ID; else automatic), `itemKind?`, `hsn?`, `unit?`, `gstRatePct?`, `purchasePricePaise?`, `salePricePaise?` |
| `purchase_bill` | `date`, `dueDate?`, `party`, `billNo`, `lines[]` (`item`, `qty`, `ratePaise`, `rateIncludesTax?`, `gstRatePct?`, `discountPct?`), `expectedTotalPaise?`, `roundOff?`, `notes?`, `paidFrom?` (account), `paymentMode?` — entered unpaid unless `paidFrom` is given (then fully paid from that account); refused if its total differs from `expectedTotalPaise` |
| `expense` | `date`, `category` (made if new), `amountPaise`, `account`, `payee?` or `party?`, `paymentMode?`, `paymentRef?`, `note?` |
| `other_income` | `date`, `category`, `amountPaise`, `account`, `payer?`, `paymentMode?`, `paymentRef?`, `note?` |
| `payment_out` / `payment_in` | `date`, `party`, `amountPaise`, `account`, `paymentMode?`, `paymentRef?`, `note?` — settles the party's oldest open bills |
| `transfer` | `date`, `from`, `to` (accounts), `amountPaise`, `note?` |
| `relink` | `voucher` (`id` or `number` like `EXP-12`), `account`, `paymentMode?` — moves an existing expense/payment to another account (e.g. recorded as cash, paid by bank) |

### Results

One per entry, in order: `status` is `created` / `would_create`, `changed` / `would_change` (relink),
`already_entered`, or `error` with a `message`. Created entries carry `id`, `number`, `link` (path in
the app) and, for bills and payments, `totalPaise`. Bills and payments also carry `possibleDuplicates`: active entries with the same amount within
3 days (or, for a purchase bill, the same supplier bill number), to catch things already entered by hand.

## Command line (owner's Mac)

```
node scripts/books/api.mjs reference > reference.json
node scripts/books/api.mjs check batch.json   # dry run
node scripts/books/api.mjs post  batch.json   # dry run, then saves only if it was clean
```

`--url` / `BILLING_API_URL` point it elsewhere (e.g. a local copy); `--key-env NAME` picks another key variable.

## Telegram

The Telegram bill bot (`docs/telegram.md`) builds the same entries from a bill photo and runs them through this
batch code inside the server, so it needs no API key.
