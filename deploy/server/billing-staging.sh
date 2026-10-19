#!/bin/bash
# Day-to-day control of the STAGING copy of the billing app (installed as `billing-staging`). Run with sudo:
#   sudo billing-staging status          is it up, and which version is on it
#   sudo billing-staging deploy          build and (re)start after new code is uploaded
#   sudo billing-staging refresh-data    replace staging's books with a fresh copy of the LIVE books
#   sudo billing-staging logs [service]
# It never touches the live app, its database, its images or its backups.
set -euo pipefail

ROOT=/opt/billing-staging
APP="$ROOT/app"
LIVE_DB=billing-db-1
COMPOSE=(docker compose -p billing-staging --project-directory "$APP/deploy" --env-file "$ROOT/.env" -f "$APP/deploy/docker-compose.yml" -f "$APP/deploy/docker-compose.shared-nginx.yml" -f "$APP/deploy/docker-compose.staging.yml")
STATE="$ROOT/state"
mkdir -p "$STATE"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
dc() { "${COMPOSE[@]}" "$@"; }
env_get() { grep -E "^$1=" "$ROOT/.env" | tail -n1 | cut -d= -f2- ; }
health_url() { echo "http://127.0.0.1:$(env_get APP_LOCAL_PORT)/api/health"; }
wait_healthy() {
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$(health_url)" 2>/dev/null && return 0; sleep 3; done
  return 1
}

cmd="${1:-status}"
shift || true

case "$cmd" in
  status)
    say "Containers"; dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    say "App (local)"; curl -fsS -o /dev/null -w '%{url} → HTTP %{http_code} in %{time_total}s\n' "$(health_url)" || echo "NOT reachable"
    domain=$(env_get APP_DOMAIN)
    say "Public site"; curl -fsS -o /dev/null -w "https://$domain → HTTP %{http_code}\n" "https://$domain/api/health" 2>/dev/null || echo "https://$domain not reachable yet (DNS/Certbot may still be pending)"
    say "Version on staging"; cat "$STATE/version" 2>/dev/null || echo "(none recorded)"
    say "Books last copied from live"; cat "$STATE/data-refreshed" 2>/dev/null || echo "(never)"
    ;;

  deploy)
    say "Building (legacy builder, as on the live app)"
    DOCKER_BUILDKIT=0 dc build db app
    say "Starting"
    dc up -d --remove-orphans db app
    wait_healthy || { say "App did not become healthy — see: sudo billing-staging logs app"; exit 1; }
    say "Staging is healthy"
    docker image prune -f >/dev/null
    ;;

  refresh-data)
    docker inspect "$LIVE_DB" >/dev/null 2>&1 || { echo "The live database container ($LIVE_DB) isn't running." >&2; exit 1; }
    say "Making sure staging's database is up"
    dc up -d db
    for _ in $(seq 1 30); do dc exec -T db pg_isready -U billing -d postgres >/dev/null 2>&1 && break; sleep 2; done
    say "Stopping the staging app"
    dc stop app
    say "Replacing staging's books with a copy of the live books (the live books are only read)"
    dc exec -T db psql -U billing -d postgres -q -c 'drop database if exists billing with (force)' -c 'create database billing owner billing'
    docker exec "$LIVE_DB" sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges "$POSTGRES_DB"' | dc exec -T db psql -U billing -d billing -q -v ON_ERROR_STOP=1 >/dev/null
    say "Removing logins, keys and links that must not work on staging"
    dc exec -T db psql -U billing -d billing -q -v ON_ERROR_STOP=1 <<'SQL'
delete from sessions;
delete from login_attempts;
delete from api_keys;
delete from share_links;
delete from partner_payout_links;
delete from telegram_links;
delete from telegram_link_codes;
delete from telegram_updates;
delete from telegram_files;
delete from telegram_drafts;
delete from telegram_config;
delete from backup_runs;
delete from backup_requests;
update zatca_settings set enabled = false, status = 'not_started', private_key_enc = null, compliance_secret_enc = null, production_secret_enc = null;
update settings set value = 'false'::jsonb where key in ('apiEnabled', 'telegramEnabled');
SQL
    say "Starting the staging app (new migrations run now, on the live data)"
    dc up -d app
    wait_healthy || { say "App did not become healthy — see: sudo billing-staging logs app"; exit 1; }
    TZ=Asia/Kolkata date '+%d %b %Y %H:%M IST' > "$STATE/data-refreshed"
    say "Done. Staging has a copy of the live books as of $(cat "$STATE/data-refreshed")."
    ;;

  logs) dc logs --tail=200 -f "${1:-app}" ;;

  *) echo "unknown command: $cmd (status | deploy | refresh-data | logs)" >&2; exit 2 ;;
esac
