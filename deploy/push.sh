#!/bin/bash
# Run on the Mac: upload the code to the Oracle VM and deploy it to the LIVE app.
#   deploy/push.sh <ssh-login> [--setup --domain billing.example.com --email owner@example.com] [--skip-staging-check]
# Only `main` may go live, it must be pushed to GitHub, and that exact version must already be on staging
# (deploy/push-staging.sh). --skip-staging-check is for emergencies only.
# Examples:
#   deploy/push.sh opc@203.0.113.10 --setup --domain billing.example.com --email me@example.com   (first time)
#   deploy/push.sh opc@203.0.113.10                                                                (every update)
set -euo pipefail
HOST="${1:?ssh login, e.g. opc@203.0.113.10}"
shift
SETUP=0; SETUP_ARGS=(); SKIP_STAGING=0
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) SETUP=1; shift ;;
    --skip-staging-check) SKIP_STAGING=1; shift ;;
    --domain|--email|--ssh-from) SETUP_ARGS+=("$1" "$2"); shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

if [ "$SETUP" = 0 ]; then
  die() { echo "✖ Not deploying to live: $*" >&2; exit 1; }
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "you're on '$(git rev-parse --abbrev-ref HEAD)'. Only main goes live (merge develop into main after staging is checked)."
  [ -z "$(git status --porcelain)" ] || die "there are uncommitted changes."
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main isn't the same as GitHub's main yet (git push origin main)."
  if [ "$SKIP_STAGING" = 1 ]; then
    echo "⚠ Skipping the staging check. Use this only for an emergency fix."
  else
    STAGED=$(ssh "$HOST" 'sudo cat /opt/billing-staging/state/tree 2>/dev/null || true')
    [ "$STAGED" = "$(git rev-parse 'HEAD^{tree}')" ] || die "this exact version isn't on staging yet (staging has: $(ssh "$HOST" 'sudo cat /opt/billing-staging/state/version 2>/dev/null || echo nothing')). Run deploy/push-staging.sh, check it, then try again."
  fi
fi

echo "▶ Running tests before upload"
npm test --silent

echo "▶ Uploading code to $HOST"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude .env --exclude '.env.*' \
  --exclude .data --exclude coverage --exclude '*.log' \
  ./ "$HOST:billing-upload/"
ssh "$HOST" 'sudo mkdir -p /opt/billing/app && sudo rsync -a --delete ~/billing-upload/ /opt/billing/app/ && sudo chown -R root:root /opt/billing/app'

if [ "$SETUP" = 1 ]; then
  echo "▶ Preparing the server"
  ssh -t "$HOST" "sudo bash /opt/billing/app/deploy/server/setup-server.sh ${SETUP_ARGS[*]}"
fi

echo "▶ Deploying"
ssh -t "$HOST" 'sudo billing deploy && sudo billing status'
