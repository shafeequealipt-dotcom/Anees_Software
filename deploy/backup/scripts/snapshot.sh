#!/bin/bash
# Nightly snapshot: database export + uploaded files, test-restored, encrypted, copied off the server.
#   snapshot.sh [label]     label is optional, e.g. "pre-deploy" or "year-end"
source /opt/backup/common.sh

LABEL="${1:-nightly}"
STARTED=$(date -Iseconds)
STAMP=$(date '+%Y-%m-%d_%H%M')
NAME="snapshot-${STAMP}-${LABEL}.tar.age"
WORK=$(mktemp -d /tmp/snapshot.XXXX)
FAILED=""
WARN=""
trap 'rm -rf "$WORK"' EXIT

fail() {
  FAILED="$1"
  log "FAILED: $1"
  record_run "snapshot" "$STARTED" false "$NAME" "" "$1"
  notify "Backup FAILED" "The ${LABEL} backup failed at $(date '+%d %b %Y %H:%M').

Reason: $1

Your data on the server is untouched. Check the server with:
  sudo /opt/billing/app/deploy/server/billing.sh status"
  ping_healthcheck fail
  exit 1
}

[ -s "$RECIPIENTS" ] || fail "No backup encryption key installed (${RECIPIENTS}). Add the owner's public key first."
mkdir -p "$LOCAL_DIR"

# 1. Export database (consistent snapshot) and uploaded files
CUTOFF=$(psql "$DATABASE_URL" -Atc "select now()")
log "exporting database"
pg_dump "$DATABASE_URL" --format=custom --compress=6 --file="$WORK/database.dump" || fail "Database export failed."
log "packing uploaded files"
tar -C /data/uploads -czf "$WORK/uploads.tar.gz" . || fail "Could not pack uploaded files."

# 2. Prove the export restores and matches the live books
log "test-restoring into a scratch database"
psql "$ADMIN_DATABASE_URL" -qc "drop database if exists restore_check" >/dev/null
psql "$ADMIN_DATABASE_URL" -qc "create database restore_check" >/dev/null || fail "Could not create scratch database."
CHECK_URL="${DATABASE_URL%/*}/restore_check"
if ! pg_restore --no-owner --exit-on-error --dbname="$CHECK_URL" "$WORK/database.dump" 2>"$WORK/restore.err"; then
  psql "$ADMIN_DATABASE_URL" -qc "drop database if exists restore_check" >/dev/null
  fail "Test restore failed: $(head -c 500 "$WORK/restore.err")"
fi
RESTORED=$(psql "$CHECK_URL" -Atq -v cutoff="$CUTOFF" -f /opt/backup/checks.sql)
psql "$ADMIN_DATABASE_URL" -qc "drop database if exists restore_check" >/dev/null
LIVE=$(psql "$DATABASE_URL" -Atq -v cutoff="$CUTOFF" -f /opt/backup/checks.sql)
if [ "$(jq -S . <<<"$RESTORED")" != "$(jq -S . <<<"$LIVE")" ]; then
  WARN="Restored copy differs from live books (someone may have edited entries during the backup). Restored: $RESTORED Live: $LIVE"
  log "warning: $WARN"
fi

# 3. Bundle, checksum, encrypt for the owner's key (the server cannot decrypt its own backups)
jq -n --arg created "$STARTED" --arg label "$LABEL" --arg cutoff "$CUTOFF" \
  --argjson fingerprint "$RESTORED" \
  --arg db_sha "$(sha256sum "$WORK/database.dump" | cut -d' ' -f1)" \
  --arg up_sha "$(sha256sum "$WORK/uploads.tar.gz" | cut -d' ' -f1)" \
  '{format: 1, created: $created, label: $label, cutoff: $cutoff, fingerprint: $fingerprint,
    files: {"database.dump": $db_sha, "uploads.tar.gz": $up_sha}}' >"$WORK/manifest.json"
tar -C "$WORK" -cf "$WORK/bundle.tar" manifest.json database.dump uploads.tar.gz
age --encrypt --recipients-file "$RECIPIENTS" --output "$LOCAL_DIR/$NAME" "$WORK/bundle.tar" || fail "Encryption failed."
SIZE=$(stat -c %s "$LOCAL_DIR/$NAME")
log "encrypted snapshot: $NAME ($SIZE bytes)"

# 4. Copy off the server
DOW=$(date +%u)   # 7 = Sunday
DOM=$(date +%d)
TIERS="daily"
[ "$LABEL" = "nightly" ] && [ "$DOW" = "7" ] && TIERS="$TIERS weekly"
[ "$LABEL" = "nightly" ] && [ "$DOM" = "01" ] && TIERS="$TIERS monthly"
[ "$LABEL" = "nightly" ] || TIERS="manual"

COPIES=("server")
if oci_enabled; then
  for tier in $TIERS; do
    rclone copyto --s3-upload-cutoff 64M "$LOCAL_DIR/$NAME" "oci:${OCI_BUCKET_SNAPSHOTS}/${tier}/${NAME}" \
      || fail "Upload to Oracle Object Storage (${tier}) failed."
  done
  rclone check --one-way --size-only "$LOCAL_DIR" "oci:${OCI_BUCKET_SNAPSHOTS}/$(echo "$TIERS" | cut -d' ' -f1)" \
    --include "$NAME" >/dev/null 2>&1 || fail "Uploaded copy in Oracle Object Storage doesn't match."
  COPIES+=("oracle")
else
  WARN="${WARN:+$WARN | }Oracle Object Storage not configured — backup kept on the server only."
fi

if gdrive_enabled; then
  for tier in $TIERS; do
    rclone copyto "$LOCAL_DIR/$NAME" "gdrive:${GDRIVE_FOLDER}/${tier}/${NAME}" \
      || fail "Upload to Google Drive (${tier}) failed."
  done
  COPIES+=("google-drive")
fi

# 5. Retention
prune_local "$KEEP_LOCAL"
if oci_enabled; then
  prune "oci:${OCI_BUCKET_SNAPSHOTS}/daily" "$KEEP_DAILY"
  prune "oci:${OCI_BUCKET_SNAPSHOTS}/weekly" "$KEEP_WEEKLY"
  prune "oci:${OCI_BUCKET_SNAPSHOTS}/monthly" "$KEEP_MONTHLY"
  prune "oci:${OCI_BUCKET_SNAPSHOTS}/manual" "$KEEP_DAILY"
fi
if gdrive_enabled; then
  prune "gdrive:${GDRIVE_FOLDER}/daily" "$KEEP_DAILY"
  prune "gdrive:${GDRIVE_FOLDER}/weekly" "$KEEP_WEEKLY"
  prune "gdrive:${GDRIVE_FOLDER}/monthly" "$KEEP_MONTHLY"
  prune "gdrive:${GDRIVE_FOLDER}/manual" "$KEEP_DAILY"
fi

DETAILS=$(jq -n --arg copies "$(IFS=,; echo "${COPIES[*]}")" --arg tiers "$TIERS" --argjson fp "$RESTORED" \
  '{copies: ($copies | split(",")), tiers: ($tiers | split(" ")), fingerprint: $fp}')
if [ -n "$WARN" ]; then
  record_run "snapshot" "$STARTED" false "$NAME" "$SIZE" "Backup saved with a warning: $WARN" "$DETAILS"
  notify "Backup saved with a warning" "$WARN"
  ping_healthcheck
else
  record_run "snapshot" "$STARTED" true "$NAME" "$SIZE" "Saved to: ${COPIES[*]}. Test restore matched the live books." "$DETAILS"
  ping_healthcheck
fi
log "done"
