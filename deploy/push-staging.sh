#!/bin/bash
# Run on the Mac: upload the code to the STAGING copy on the server and deploy it there. Any branch may go to staging.
#   deploy/push-staging.sh <ssh-login> [--setup --domain billing-staging.example.com] [--tls] [--refresh-data]
# Examples:
#   deploy/push-staging.sh billing-prod --setup --domain billing-staging.dnhcare.co.in   (first time, HTTP only)
#   deploy/push-staging.sh billing-prod --tls --domain billing-staging.dnhcare.co.in     (after the DNS record exists)
#   deploy/push-staging.sh billing-prod                                                  (every update)
#   deploy/push-staging.sh billing-prod --refresh-data                                   (also copy the live books in first)
# The version that went up is recorded on the server; deploy/push.sh (live) only accepts a version that was staged.
set -euo pipefail
HOST="${1:?ssh login, e.g. billing-prod}"
shift
SETUP=0 TLS=0 REFRESH=0 DOMAIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) SETUP=1; shift ;;
    --tls) TLS=1; shift ;;
    --refresh-data) REFRESH=1; shift ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
echo "▶ Running tests before upload"
npm test --silent

echo "▶ Uploading code to staging on $HOST"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude .env --exclude '.env.*' \
  --exclude .data --exclude coverage --exclude '*.log' \
  ./ "$HOST:billing-staging-upload/"
ssh "$HOST" 'sudo mkdir -p /opt/billing-staging/app && sudo rsync -a --delete ~/billing-staging-upload/ /opt/billing-staging/app/ && sudo chown -R root:root /opt/billing-staging/app'

if [ "$SETUP" = 1 ] || [ "$TLS" = 1 ]; then
  [ -n "$DOMAIN" ] || { echo "--domain is required with --setup / --tls" >&2; exit 2; }
  echo "▶ Preparing staging on the server"
  ssh -t "$HOST" "sudo bash /opt/billing-staging/app/deploy/server/setup-staging.sh --domain $DOMAIN $([ "$TLS" = 1 ] && echo --tls)"
fi

if [ "$REFRESH" = 1 ]; then
  echo "▶ Copying the live books into staging"
  ssh -t "$HOST" 'sudo billing-staging refresh-data'
fi

echo "▶ Deploying to staging"
ssh -t "$HOST" 'sudo billing-staging deploy'

# Record which version is on staging. The tree hash is the content of the code, so a fast-forward or merge
# commit of the same content still counts; a dirty working tree is recorded as such and can't be promoted.
if [ -z "$(git status --porcelain)" ]; then TREE=$(git rev-parse 'HEAD^{tree}'); else TREE=DIRTY; fi
INFO="$(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)$([ "$TREE" = DIRTY ] && echo ' (with uncommitted changes)') · deployed $(date '+%d %b %Y %H:%M')"
ssh "$HOST" "echo '$TREE' | sudo tee /opt/billing-staging/state/tree >/dev/null && echo '$INFO' | sudo tee /opt/billing-staging/state/version >/dev/null"
echo "✔ Staging now has: $INFO"
