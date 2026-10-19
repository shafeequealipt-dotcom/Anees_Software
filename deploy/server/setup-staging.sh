#!/bin/bash
# One-time preparation of the STAGING copy on the live server. Safe to re-run.
#   sudo bash /opt/billing-staging/app/deploy/server/setup-staging.sh --domain billing-staging.example.com [--tls]
# Without --tls: creates /opt/billing-staging, its own secrets, the `billing-staging` command and an HTTP-only nginx site.
# With --tls (after the domain's DNS record points at this server): gets the HTTPS certificate from Let's Encrypt.
# It never touches the live app, the live .env or the live nginx site.
set -euo pipefail

DOMAIN="" TLS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --tls) TLS=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
[ -n "$DOMAIN" ] || { echo "--domain is required" >&2; exit 2; }

ROOT=/opt/billing-staging
LIVE=/opt/billing
HERE="$(cd "$(dirname "$0")" && pwd)"
LOCAL_PORT=8092
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step "Folders and the staging command"
mkdir -p "$ROOT/app" "$ROOT/state"
install -m 755 "$HERE/billing-staging.sh" /usr/local/bin/billing-staging

if [ ! -f "$ROOT/.env" ]; then
  step "Staging's own settings and secrets (generated here, never shown)"
  umask 077
  {
    echo "APP_DOMAIN=$DOMAIN"
    echo "ACME_EMAIL=$(grep -E '^ACME_EMAIL=' "$LIVE/.env" | tail -n1 | cut -d= -f2-)"
    echo "APP_LOCAL_PORT=$LOCAL_PORT"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_SECRET=$(openssl rand -hex 32)"
    echo "PG_SHARED_BUFFERS=96MB"
    echo "PG_EFFECTIVE_CACHE_SIZE=256MB"
    echo "PG_WORK_MEM=4MB"
    echo "PG_MAINTENANCE_WORK_MEM=32MB"
    echo "PG_MAX_CONNECTIONS=40"
  } > "$ROOT/.env"
  chmod 600 "$ROOT/.env"
else
  echo "(.env already exists, left as it is)"
fi

SITE="/etc/nginx/sites-available/$DOMAIN"
if [ ! -f "$SITE" ]; then
  step "nginx site for $DOMAIN (HTTP for now)"
  cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:$LOCAL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 300;
    }
}
NGINX
  ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t
  systemctl reload nginx
fi

if [ "$TLS" = 1 ]; then
  step "HTTPS certificate for $DOMAIN"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$(grep -E '^ACME_EMAIL=' "$ROOT/.env" | cut -d= -f2-)" --redirect
  nginx -t && systemctl reload nginx
fi
echo
echo "Staging setup done. Next: sudo billing-staging deploy   (push-staging.sh does this for you)"
