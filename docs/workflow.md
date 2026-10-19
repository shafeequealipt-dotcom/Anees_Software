# How changes reach the live books

```
   develop  ──(push-staging.sh)──▶  STAGING   billing-staging.dnhcare.co.in   (a test copy of the live books)
      │                                  │ check it
      └── merge into main ◀──────────────┘
   main     ──(push.sh)──────────▶  LIVE      billing.dnhcare.co.in
```

- **`main`** is exactly what is live. **`develop`** is where every change is made and tried first.
- GitHub (`shafeequealipt-dotcom/Anees_Software`) holds both. A GitHub check runs the type-check and all tests on
  every push to `develop` or `main`.

## Making a change (Claude does this)

1. Work on `develop`; commit.
2. `deploy/push-staging.sh billing-prod` — runs the tests, uploads to the staging copy, builds and starts it, and
   records which version is there. Add `--refresh-data` to first replace staging's books with a fresh copy of the live
   books (this also tries any new database migration on real data).
3. Check it on staging (red **STAGING** bar on every page). The owner says "approved".
4. `git checkout main && git merge --ff-only develop && git push origin main && git push origin develop`.
5. Take a manual backup of the live books, then `deploy/push.sh billing-prod`.

`push.sh` refuses to deploy live unless: you're on `main`, nothing is uncommitted, `main` is pushed to GitHub, and
the exact same code (compared by content) is the version last deployed to staging. For a real emergency only,
`--skip-staging-check` bypasses the staging check; say so afterwards and put the fix through staging too.

## What staging is

- A second copy of the app on the same Oracle server: own containers (`billing-staging-*`), own database, own
  uploads, own secret key, own settings file (`/opt/billing-staging/.env`). Controlled with `sudo billing-staging
  status | deploy | refresh-data | logs`.
- **Its books are a copy of the live books**, so testing is realistic. `refresh-data` reads the live database
  (never writes it), replaces staging's with a copy, then removes sessions, API keys, share links, Telegram
  links/bot settings and ZATCA secrets from the copy and turns API/Telegram off for every company. Everyone signs in
  to staging with their normal email and password (and MFA if they use it).
- **Nothing leaves staging**: WhatsApp, email and cron secrets are blank; no backup archiving and no access to the
  live backup bucket; the live API keys don't exist there; the live Telegram bot isn't connected (to try the Telegram
  bot on staging, make a second bot with @BotFather and connect that one on staging).
- Because staging has its own secret key, anything encrypted by the live app (bot token, AI key, e-invoicing keys)
  is unreadable on staging by design.

## One-time setup (done 19 Oct 2026)

1. DNS (GoDaddy): an `A` record `billing-staging` → the server's address (same as `billing`).
2. `deploy/push-staging.sh billing-prod --setup --domain billing-staging.dnhcare.co.in` (code, secrets, nginx).
3. `deploy/push-staging.sh billing-prod --tls --domain billing-staging.dnhcare.co.in` (HTTPS certificate).
4. `ssh billing-prod 'sudo billing-staging refresh-data'`.
