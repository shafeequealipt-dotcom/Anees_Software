#!/bin/bash
# Shared helpers for backup jobs.
set -euo pipefail

export RCLONE_CONFIG="${RCLONE_CONFIG:-/secrets/rclone.conf}"
[ -f "$RCLONE_CONFIG" ] || export RCLONE_CONFIG=/dev/null

# Oracle Object Storage through its S3-compatible API, configured from the environment.
export RCLONE_CONFIG_OCI_TYPE=s3
export RCLONE_CONFIG_OCI_PROVIDER=Other
export RCLONE_CONFIG_OCI_ENDPOINT="https://${OCI_S3_HOST:-}"
export RCLONE_CONFIG_OCI_REGION="${OCI_REGION:-}"
export RCLONE_CONFIG_OCI_ACCESS_KEY_ID="${OCI_ACCESS_KEY:-}"
export RCLONE_CONFIG_OCI_SECRET_ACCESS_KEY="${OCI_SECRET_KEY:-}"
export RCLONE_CONFIG_OCI_FORCE_PATH_STYLE=true
export RCLONE_CONFIG_OCI_NO_CHECK_BUCKET=true

LOCAL_DIR=/backups/local
RECIPIENTS=/secrets/backup-recipients.txt
KEEP_LOCAL=8
KEEP_DAILY=30
KEEP_WEEKLY=12
KEEP_MONTHLY=12
KEEP_YEARLY=8

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

oci_enabled() { [ -n "${OCI_S3_HOST:-}" ] && [ -n "${OCI_ACCESS_KEY:-}" ] && [ -n "${OCI_BUCKET_SNAPSHOTS:-}" ]; }
gdrive_enabled() { [ "${GDRIVE_ENABLED:-false}" = "true" ] && [ "$RCLONE_CONFIG" != /dev/null ]; }

sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }

# record_run KIND STARTED_ISO OK(true|false) FILE SIZE MESSAGE [DETAILS_JSON]
record_run() {
  local details="${7:-null}"
  [ -z "$details" ] && details=null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -qAtc "
    insert into backup_runs (kind, started_at, finished_at, ok, file_name, size_bytes, message, details)
    values ('$(sql_escape "$1")', '$2', now(), $3,
            nullif('$(sql_escape "$4")',''), nullif('$5','')::bigint,
            '$(sql_escape "$6")', '$(sql_escape "$details")'::jsonb)" >/dev/null 2>&1 \
    || log "warning: could not record run in database"
}

notify() {
  # notify SUBJECT BODY
  local subject="$1" body="$2"
  if [ -n "${SMTP_URL:-}" ] && [ -n "${ALERT_EMAIL_TO:-}" ]; then
    local msg
    msg=$(mktemp)
    {
      printf 'From: Billing backups <%s>\r\n' "${SMTP_USER}"
      printf 'To: %s\r\n' "${ALERT_EMAIL_TO}"
      printf 'Subject: [%s] %s\r\n' "${APP_DOMAIN:-billing}" "$subject"
      printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
      printf '%s\r\n' "$body"
    } >"$msg"
    curl -fsS --max-time 60 --ssl-reqd --url "$SMTP_URL" \
      --user "${SMTP_USER}:${SMTP_PASSWORD}" \
      --mail-from "${SMTP_USER}" --mail-rcpt "${ALERT_EMAIL_TO}" \
      -T "$msg" >/dev/null 2>&1 || log "warning: alert email could not be sent"
    rm -f "$msg"
  else
    log "alert (email not configured): $subject — $body"
  fi
}

ping_healthcheck() {
  # ping_healthcheck [fail]
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  local url="$HEALTHCHECK_URL"
  [ "${1:-}" = "fail" ] && url="$url/fail"
  curl -fsS --max-time 20 --retry 3 "$url" >/dev/null 2>&1 || true
}

# prune REMOTE_PATH KEEP  — delete oldest files beyond KEEP (names sort by date)
prune() {
  local path="$1" keep="$2" files count
  files=$(rclone lsf --files-only "$path" 2>/dev/null | grep -E '^snapshot-.*\.tar\.age$' | sort || true)
  count=$(printf '%s\n' "$files" | grep -c . || true)
  if [ "$count" -le "$keep" ]; then return 0; fi
  printf '%s\n' "$files" | head -n $((count - keep)) | while read -r f; do
    if rclone deletefile "$path/$f" 2>/dev/null; then
      log "pruned $path/$f"
    else
      log "kept $path/$f (retention lock or error)"
    fi
  done
}

prune_local() {
  local keep="$1"
  ls -1 "$LOCAL_DIR"/snapshot-*.tar.age 2>/dev/null | sort | head -n -"$keep" | xargs -r rm -f
}
