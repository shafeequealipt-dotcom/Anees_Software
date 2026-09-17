#!/bin/bash
# Run on the Mac: upload the code to the Oracle VM and deploy it.
#   deploy/push.sh <ssh-login> [--setup --domain billing.example.com --email owner@example.com]
# Examples:
#   deploy/push.sh opc@203.0.113.10 --setup --domain billing.example.com --email me@example.com   (first time)
#   deploy/push.sh opc@203.0.113.10                                                                (every update)
set -euo pipefail
HOST="${1:?ssh login, e.g. opc@203.0.113.10}"
shift
SETUP=0; SETUP_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) SETUP=1; shift ;;
    --domain|--email|--ssh-from) SETUP_ARGS+=("$1" "$2"); shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
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
