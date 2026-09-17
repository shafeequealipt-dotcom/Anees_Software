#!/bin/bash
# Restore an encrypted snapshot. Needs the OWNER'S PRIVATE KEY, which is never stored on the server.
#
#   restore-snapshot.sh <snapshot-file> <private-key-file> [--into-scratch|--replace-live]
#
#   <snapshot-file>     path under /restore or /backups/local, or "oci:daily/<name>" / "gdrive:daily/<name>"
#   <private-key-file>  the owner's age key, copied temporarily to /opt/billing/restore/ (deleted afterwards)
#   --into-scratch      (default) restore into database "billing_restored" to look at old data safely
#   --replace-live      replace the live database and uploads (the app must be stopped first;
#                       billing.sh restore-snapshot does that for you)
source /opt/backup/common.sh

SRC="${1:?snapshot file required}"
KEY="${2:?private key file required}"
MODE="${3:---into-scratch}"
WORK=$(mktemp -d /tmp/restore.XXXX)
trap 'rm -rf "$WORK"' EXIT
STARTED=$(date -Iseconds)

case "$SRC" in
  oci:*)    log "downloading from Oracle Object Storage"; rclone copyto "oci:${OCI_BUCKET_SNAPSHOTS}/${SRC#oci:}" "$WORK/in.tar.age" ;;
  archive:*) log "downloading from archive bucket"; rclone copyto "oci:${OCI_BUCKET_ARCHIVE}/${SRC#archive:}" "$WORK/in.tar.age" ;;
  gdrive:*) log "downloading from Google Drive"; rclone copyto "gdrive:${GDRIVE_FOLDER}/${SRC#gdrive:}" "$WORK/in.tar.age" ;;
  *)        cp "$SRC" "$WORK/in.tar.age" ;;
esac

log "decrypting"
age --decrypt --identity "$KEY" --output "$WORK/bundle.tar" "$WORK/in.tar.age"
tar -C "$WORK" -xf "$WORK/bundle.tar"

log "verifying checksums"
for f in database.dump uploads.tar.gz; do
  expected=$(jq -r --arg f "$f" '.files[$f]' "$WORK/manifest.json")
  actual=$(sha256sum "$WORK/$f" | cut -d' ' -f1)
  [ "$expected" = "$actual" ] || { log "checksum mismatch for $f"; exit 1; }
done
log "snapshot taken $(jq -r .created "$WORK/manifest.json") ($(jq -r .label "$WORK/manifest.json"))"

case "$MODE" in
  --into-scratch)
    psql "$ADMIN_DATABASE_URL" -qc "drop database if exists billing_restored"
    psql "$ADMIN_DATABASE_URL" -qc "create database billing_restored"
    pg_restore --no-owner --exit-on-error --dbname="${DATABASE_URL%/*}/billing_restored" "$WORK/database.dump"
    mkdir -p /restore/uploads-restored
    tar -C /restore/uploads-restored -xzf "$WORK/uploads.tar.gz"
    record_run "restore-scratch" "$STARTED" true "$(basename "$SRC")" "" "Restored into scratch database billing_restored."
    log "restored into database 'billing_restored' (live data untouched). Uploads in /opt/billing/restore/uploads-restored"
    ;;
  --replace-live)
    live_conns=$(psql "$ADMIN_DATABASE_URL" -Atc "select count(*) from pg_stat_activity where datname='billing' and pid <> pg_backend_pid()")
    if [ "$live_conns" != "0" ]; then
      log "the app is still connected to the database — stop it first (billing.sh restore-snapshot does this)"
      exit 1
    fi
    psql "$ADMIN_DATABASE_URL" -qc "drop database if exists billing_before_restore"
    psql "$ADMIN_DATABASE_URL" -qc "alter database billing rename to billing_before_restore"
    psql "$ADMIN_DATABASE_URL" -qc "create database billing"
    if ! pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$WORK/database.dump"; then
      log "restore failed — putting the previous database back"
      psql "$ADMIN_DATABASE_URL" -qc "drop database if exists billing"
      psql "$ADMIN_DATABASE_URL" -qc "alter database billing_before_restore rename to billing"
      exit 1
    fi
    mkdir -p /data/uploads
    find /data/uploads -mindepth 1 -delete
    tar -C /data/uploads -xzf "$WORK/uploads.tar.gz"
    record_run "restore-live" "$STARTED" true "$(basename "$SRC")" "" "Live books replaced from snapshot. Previous database kept as billing_before_restore."
    log "live database replaced. The previous database is kept as 'billing_before_restore' until you drop it."
    ;;
  *)
    echo "unknown mode $MODE" >&2; exit 2 ;;
esac
