#!/bin/bash
# Entry point for systemd timers (see systemd/billing-*.timer).
set -uo pipefail
ROOT=/opt/billing
# Nothing to do until the app has been deployed once.
[ -f "$ROOT/state/deployed" ] || exit 0
pitr_configured() { grep -Eq '^OCI_ACCESS_KEY=.+' "$ROOT/.env" && docker compose --project-directory "$ROOT/app/deploy" --env-file "$ROOT/.env" exec -T db test -f /var/lib/postgresql/data/.pitr-enabled; }
case "${1:-}" in
  pitr-full)   pitr_configured || exit 0; exec /usr/local/bin/billing pitr full ;;
  pitr-diff)   pitr_configured || exit 0; exec /usr/local/bin/billing pitr diff ;;
  snapshot)    exec /usr/local/bin/billing snapshot nightly ;;
  verify)      pitr_configured || exit 0; exec /usr/local/bin/billing verify ;;
  healthcheck) exec /usr/local/bin/billing healthcheck ;;
  backup-requests) exec /usr/local/bin/billing backup-requests ;;
  notify)
    # Sends waiting WhatsApp/email messages and prepares payment reminders. Needs CRON_SECRET in /opt/billing/.env.
    secret=$(grep -E '^CRON_SECRET=' "$ROOT/.env" | head -n1 | cut -d= -f2-)
    [ -n "$secret" ] || exit 0
    port=$(grep -E '^APP_LOCAL_PORT=' "$ROOT/.env" | head -n1 | cut -d= -f2-)
    exec curl -fsS --max-time 120 -X POST -H "x-cron-secret: $secret" -o /dev/null "http://127.0.0.1:${port:-8091}/api/cron/notify" ;;
  *) echo "unknown job $1" >&2; exit 2 ;;
esac
