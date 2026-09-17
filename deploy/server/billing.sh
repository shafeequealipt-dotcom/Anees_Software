#!/bin/bash
# Day-to-day control of the billing server. Run with sudo:
#   sudo billing status                      health, disk, last backups
#   sudo billing deploy                      build and (re)start after new code is uploaded
#   sudo billing snapshot [label]            take an encrypted snapshot now
#   sudo billing backups                     list all backup copies
#   sudo billing pitr setup|full|diff|info   point-in-time backups
#   sudo billing verify                      weekly test restore of the latest point-in-time backup
#   sudo billing restore-time "2026-09-20 14:05"            put the live books back to that minute
#   sudo billing recovery-copy "2026-09-20 14:05"           open a SEPARATE copy as of that minute
#   sudo billing recovery-stop                              remove that separate copy
#   sudo billing restore-snapshot <file> <owner-key-file>   replace live books from a snapshot
#   sudo billing logs [service]
#   sudo billing healthcheck                  (run by timer) alert if something is wrong
set -euo pipefail

ROOT=/opt/billing
APP="$ROOT/app"
COMPOSE=(docker compose --project-directory "$APP/deploy" --env-file "$ROOT/.env" -f "$APP/deploy/docker-compose.yml")
STATE="$ROOT/state"
mkdir -p "$STATE" "$ROOT/restore"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
dc() { "${COMPOSE[@]}" "$@"; }
env_get() { grep -E "^$1=" "$ROOT/.env" | tail -n1 | cut -d= -f2- ; }
psql_db() { dc exec -T db psql -U billing -d billing -Atc "$1"; }
backup_job() { dc run --rm -T backup "$@"; }
record() { backup_job record "$1" "$2" "$3" >/dev/null 2>&1 || true; }

cmd="${1:-status}"
shift || true

case "$cmd" in
  status)
    say "Containers"; dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    say "Website";  curl -fsS -o /dev/null -w 'https://%{url.host} → HTTP %{http_code} in %{time_total}s\n' "https://$(env_get APP_DOMAIN)/api/health" || echo "NOT reachable"
    say "Disk";     df -h / | tail -n1
    say "Last backups"
    psql_db "select kind, to_char(started_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'), case when ok then 'OK' else 'PROBLEM' end, coalesce(file_name,''), left(message,120)
             from (select distinct on (kind) * from backup_runs order by kind, started_at desc) t order by started_at desc" \
      | column -t -s '|' || echo "(no backup records yet)"
    say "Change-log shipping (point-in-time)"
    psql_db "select 'archived: '||archived_count||', failed: '||failed_count||', last: '||coalesce(to_char(last_archived_time at time zone 'Asia/Kolkata','DD Mon HH24:MI:SS'),'never') from pg_stat_archiver"
    ;;

  deploy)
    say "Snapshot before deploy"
    if dc ps --status running db | grep -q db; then backup_job snapshot pre-deploy || say "(snapshot failed — continuing because this may be the first deploy)"; fi
    say "Building"
    dc build --pull
    say "Starting"
    dc up -d --remove-orphans db app caddy
    for _ in $(seq 1 60); do
      if dc exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then say "App is healthy"; break; fi
      sleep 3
    done
    dc exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null || { say "App did not become healthy — see: sudo billing logs app"; exit 1; }
    touch "$STATE/deployed"
    docker image prune -f >/dev/null
    ;;

  snapshot)      backup_job snapshot "${1:-manual}" ;;
  yearly)        backup_job yearly "${1:?financial year, e.g. 2025-26}" ;;
  backups)       backup_job list ;;

  pitr)
    sub="${1:?setup|full|diff|info|check}"
    case "$sub" in setup|full|diff) tracked=1 ;; *) tracked=0 ;; esac
    if dc exec -T -u postgres db pitr.sh "$sub"; then
      if [ "$tracked" = 1 ]; then record "pitr-$sub" true "Point-in-time backup ($sub) completed."; fi
    else
      if [ "$tracked" = 1 ]; then record "pitr-$sub" false "Point-in-time backup ($sub) FAILED. Run: sudo billing pitr check"; fi
      exit 1
    fi
    ;;

  verify)
    if out=$(dc exec -T -u postgres db pitr.sh verify 2>&1); then
      summary=$(printf '%s\n' "$out" | tail -n1)
      record "pitr-verify" true "Weekly test restore succeeded: $summary"
      echo "$summary"
    else
      record "pitr-verify" false "Weekly test restore FAILED: $(printf '%s' "$out" | tail -n 5 | tr '\n' ' ')"
      printf '%s\n' "$out"; exit 1
    fi
    ;;

  restore-time)
    target="${1:?time, e.g. \"2026-09-20 14:05\"}"
    say "This replaces the LIVE books with how they were at $target (IST)."
    read -r -p "Type RESTORE to continue: " ok; [ "$ok" = "RESTORE" ] || exit 1
    backup_job snapshot before-time-restore || say "(could not snapshot current state — continuing)"
    dc stop app
    dc stop db
    dc run --rm --no-deps -T -u postgres --entrypoint pgbackrest db \
      --stanza=main --delta --type=time "--target=${target}:00+05:30" --target-action=promote restore
    dc up -d db
    for _ in $(seq 1 100); do
      [ "$(psql_db 'select pg_is_in_recovery()' 2>/dev/null)" = "f" ] && break; sleep 3
    done
    dc up -d app
    dc exec -T -u postgres db pitr.sh full || true
    record "restore-time" true "Live books restored to $target."
    say "Done. Books are now as of $target. A fresh full backup was taken."
    ;;

  recovery-copy)
    target="${1:?time, e.g. \"2026-09-20 14:05\"}"
    docker rm -f billing-recovery-db >/dev/null 2>&1 || true
    docker volume rm billing_recovery >/dev/null 2>&1 || true
    docker volume create billing_recovery >/dev/null
    say "Restoring a separate copy as of $target (live books are not touched)"
    docker run --rm -v billing_recovery:/recovery \
      --env-file <(dc config --format json | jq -r '.services.db.environment | to_entries[] | "\(.key)=\(.value)"') \
      --entrypoint bash billing-db:17 -c \
      'mkdir -p /recovery/data && chown postgres:postgres /recovery/data && chmod 700 /recovery/data &&
       exec gosu postgres pgbackrest --stanza=main --pg1-path=/recovery/data --type=time "--target=$1" \
         --target-action=promote --archive-mode=off restore' _ "${target}:00+05:30"
    docker run -d --name billing-recovery-db --network billing_default -u postgres -v billing_recovery:/recovery \
      -e PGDATA=/recovery/data billing-db:17 postgres -c archive_mode=off >/dev/null
    say "Recovery copy running. Open it with:  sudo docker exec -it billing-recovery-db psql -U billing -d billing"
    say "Remove it when finished:            sudo billing recovery-stop"
    ;;

  recovery-stop)
    docker rm -f billing-recovery-db >/dev/null 2>&1 || true
    docker volume rm billing_recovery >/dev/null 2>&1 || true
    say "Recovery copy removed."
    ;;

  restore-snapshot)
    file="${1:?snapshot file (in /opt/billing/restore, or oci:daily/<name>, gdrive:daily/<name>)}"
    key="${2:?owner private key file in /opt/billing/restore}"
    say "This replaces the LIVE books and uploaded files with the snapshot."
    read -r -p "Type RESTORE to continue: " ok; [ "$ok" = "RESTORE" ] || exit 1
    case "$file" in oci:*|gdrive:*|archive:*) src="$file" ;; *) src="/restore/$(basename "$file")" ;; esac
    dc stop app
    trap 'rm -f "$ROOT/restore/$(basename "$key")"' EXIT
    backup_job restore-snapshot "$src" "/restore/$(basename "$key")" --replace-live
    dc up -d app
    say "Restored. The owner key copy on the server has been deleted."
    ;;

  logs) dc logs --tail=200 -f "${1:-app}" ;;

  healthcheck)
    problems=()
    domain=$(env_get APP_DOMAIN)
    curl -fsS --max-time 20 -o /dev/null "https://$domain/api/health" || problems+=("Website https://$domain is not responding.")
    used=$(df --output=pcent / | tail -n1 | tr -dc '0-9')
    [ "$used" -lt 85 ] || problems+=("Server disk is ${used}% full.")
    last_ok=$(psql_db "select coalesce(extract(epoch from now()-max(finished_at))::int, 999999) from backup_runs where kind='snapshot' and ok" 2>/dev/null || echo 999999)
    [ "${last_ok:-999999}" -lt 93600 ] || problems+=("No successful nightly backup in the last 26 hours.")
    if [ -n "$(env_get OCI_ACCESS_KEY)" ]; then
      arch=$(psql_db "select coalesce(extract(epoch from now()-last_archived_time)::int, 999999) from pg_stat_archiver" 2>/dev/null || echo 999999)
      [ "${arch:-999999}" -lt 1800 ] || problems+=("Point-in-time change logs have not reached Oracle Object Storage for over 30 minutes.")
    fi
    if [ ${#problems[@]} -gt 0 ]; then
      msg=$(printf -- '- %s\n' "${problems[@]}")
      key=$(printf '%s' "$msg" | sha1sum | cut -c1-12)
      stamp="$STATE/alert-$key"
      if [ ! -f "$stamp" ] || [ $(( $(date +%s) - $(stat -c %Y "$stamp") )) -gt 21600 ]; then
        backup_job notify "Server needs attention" "$msg" >/dev/null 2>&1 || true
        touch "$stamp"
      fi
      printf '%s\n' "$msg"; exit 1
    fi
    echo "all good"
    ;;

  *)
    sed -n '2,17p' "$0"; exit 2 ;;
esac
