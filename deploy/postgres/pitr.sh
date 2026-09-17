#!/bin/bash
# Point-in-time backup helper, run inside the db container as the postgres user:
#   pitr.sh setup        create the backup repository and switch on log shipping
#   pitr.sh full|diff    take a full / differential backup
#   pitr.sh check        confirm log shipping works end to end
#   pitr.sh info         list backups and the recoverable time range (JSON)
#   pitr.sh verify       restore the latest backup into a scratch directory and query it
set -euo pipefail
STANZA=main
DATA=/var/lib/postgresql/data

require_config() {
  if [ -z "${PGBACKREST_REPO1_S3_BUCKET:-}" ] || [ -z "${PGBACKREST_REPO1_S3_KEY:-}" ] || [ -z "${PGBACKREST_REPO1_CIPHER_PASS:-}" ]; then
    echo "Object Storage is not configured (OCI_* values in /opt/billing/.env)." >&2
    exit 3
  fi
}

case "${1:-}" in
  setup)
    require_config
    pgbackrest --stanza=$STANZA stanza-create
    touch "$DATA/.pitr-enabled"
    pgbackrest --stanza=$STANZA check
    pgbackrest --stanza=$STANZA --type=full backup
    ;;
  full|diff|incr)
    require_config
    [ -f "$DATA/.pitr-enabled" ] || { echo "Run 'pitr.sh setup' first." >&2; exit 3; }
    pgbackrest --stanza=$STANZA --type="$1" backup
    ;;
  check)
    require_config
    pgbackrest --stanza=$STANZA check
    ;;
  info)
    require_config
    pgbackrest --stanza=$STANZA --output=json info
    ;;
  verify)
    require_config
    SCRATCH=$(mktemp -d /tmp/pitr-verify.XXXX)
    trap 'pg_ctl -D "$SCRATCH" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$SCRATCH"' EXIT
    pgbackrest --stanza=$STANZA --pg1-path="$SCRATCH" --type=immediate --target-action=promote \
      --archive-mode=off restore
    chmod 700 "$SCRATCH"
    pg_ctl -D "$SCRATCH" -w -t 600 -o "-p 5499 -c archive_mode=off -c listen_addresses='' -k /tmp" start
    for _ in $(seq 1 120); do
      if [ "$(psql -h /tmp -p 5499 -U billing -d billing -Atc 'select pg_is_in_recovery()')" = "f" ]; then break; fi
      sleep 2
    done
    psql -h /tmp -p 5499 -U billing -d billing -Atc \
      "select json_build_object(
         'vouchers', (select count(*) from vouchers),
         'parties', (select count(*) from parties),
         'items', (select count(*) from items),
         'latest_voucher_date', (select max(date) from vouchers),
         'latest_change', (select max(updated_at) from vouchers)
       )"
    ;;
  *)
    echo "usage: pitr.sh setup|full|diff|check|info|verify" >&2
    exit 2
    ;;
esac
