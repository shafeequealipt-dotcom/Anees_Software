# Future features

Features not built yet, found by comparing the code (2026-09-28) against the
original roadmap (plan doc linked in `STATUS.md`). Everything here was checked in
the code, not assumed. Nothing here is scheduled; pick from it when the owner asks
for the next feature, and move items to `STATUS.md` → Done when built.

## P2 — daily-workflow parity
1. **GST returns GSTR-1 and GSTR-3B.** `reports/tax` is a tax-by-rate summary only
   (`src/app/(app)/reports/tax/page.tsx` says so). Largest compliance gap.
2. **Two-step login (TOTP) screen.** Backend done (`newTotpSecret`, `totpUri`,
   `verifyTotp` in `src/lib/auth.ts`; login already asks for the code when on).
   Missing: a page in My account to turn it on with a QR code, and to turn it off.
3. **Cheque tracking.** "Cheque" is only a payment-mode label with a reference
   field; no open / deposit / bounce / reopen flow.
4. **Item photos.** No image field on items.
5. **Barcodes.** No barcode printing or camera scanning.
6. **PIN to delete.** `requireDeletePin` exists in `src/lib/settings.ts` but nothing
   reads it. Wire it into `deleteVoucher()` or remove the setting.
7. **Custom fields on parties.** Only items have them (`src/server/custom-fields.ts`
   hardcodes `entity: "item"`; the table already has a generic `entity` column).
8. **Party groups screen.** Groups can only be added inline from the party form;
   no screen to list, rename or remove them.

## P3 — full parity
9. **Close books / start new financial year**, locking earlier years.
10. **GSTR-2, GSTR-4, GSTR-9, GSTR-9A.**
11. **Cash flow statement** (balance sheet and trial balance exist).
12. **Loan accounts** (EMI, processing fee, loan statement).
13. **Manufacturing** (build an item from raw materials).
14. **Custom report builder.**
15. **More invoice layouts and bulk print.** Classic and Modern exist today.
16. **More keyboard shortcuts.** Only Ctrl+S (save bill) and Ctrl+K (search).

## P4 — only if the business needs them
17. Online catalogue customers can order from.
18. Indian e-invoicing (IRN through a GSP). Required above ₹5 crore turnover. The
    Saudi ZATCA side is already built.
19. Offline billing that syncs later.
20. Native Android/iOS app (today: responsive web app).

## Not in the original roadmap
21. **Online payment collection** (payment link / UPI on the invoice). No gateway
    code exists yet.

## One-time data migration
- Import from a Vyapar backup file: not built. Only worth doing if old Vyapar
  history still needs to come in.
