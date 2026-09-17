#!/bin/bash
# Year-end archive: fresh snapshot copied to the Archive-tier bucket and Google Drive, kept 8 years.
#   yearly.sh 2025-26
source /opt/backup/common.sh

FY="${1:?usage: yearly.sh <financial-year, e.g. 2025-26>}"
STARTED=$(date -Iseconds)

/opt/backup/snapshot.sh "year-end-${FY}"
NAME=$(ls -1 "$LOCAL_DIR"/snapshot-*-year-end-"${FY}".tar.age | sort | tail -n 1)
NAME=$(basename "$NAME")

if oci_enabled && [ -n "${OCI_BUCKET_ARCHIVE:-}" ]; then
  rclone copyto "$LOCAL_DIR/$NAME" "oci:${OCI_BUCKET_ARCHIVE}/yearly/${NAME}"
  prune "oci:${OCI_BUCKET_ARCHIVE}/yearly" "$KEEP_YEARLY"
fi
if gdrive_enabled; then
  rclone copyto "$LOCAL_DIR/$NAME" "gdrive:${GDRIVE_FOLDER}/yearly/${NAME}"
  prune "gdrive:${GDRIVE_FOLDER}/yearly" "$KEEP_YEARLY"
fi
record_run "yearly-archive" "$STARTED" true "$NAME" "$(stat -c %s "$LOCAL_DIR/$NAME")" "Year-end archive for FY ${FY} stored for 8 years."
log "year-end archive done: $NAME"
