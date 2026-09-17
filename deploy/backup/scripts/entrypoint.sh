#!/bin/bash
# docker compose run --rm backup <job> [args]
set -euo pipefail
job="${1:-help}"
shift || true
case "$job" in
  snapshot)          exec /opt/backup/snapshot.sh "$@" ;;
  yearly)            exec /opt/backup/yearly.sh "$@" ;;
  restore-snapshot)  exec /opt/backup/restore-snapshot.sh "$@" ;;
  list)
    source /opt/backup/common.sh
    echo "── On the server (${LOCAL_DIR})"; ls -lh "$LOCAL_DIR" 2>/dev/null || true
    if oci_enabled; then
      for t in daily weekly monthly manual; do echo "── Oracle: $t"; rclone lsl "oci:${OCI_BUCKET_SNAPSHOTS}/$t" 2>/dev/null | sort -k4 || true; done
      [ -n "${OCI_BUCKET_ARCHIVE:-}" ] && { echo "── Oracle archive: yearly"; rclone lsl "oci:${OCI_BUCKET_ARCHIVE}/yearly" 2>/dev/null || true; }
    fi
    if gdrive_enabled; then
      for t in daily weekly monthly manual yearly; do echo "── Google Drive: $t"; rclone lsl "gdrive:${GDRIVE_FOLDER}/$t" 2>/dev/null | sort -k4 || true; done
    fi
    ;;
  record)
    # record KIND OK MESSAGE — used by host jobs (e.g. point-in-time backups) to log into the app
    source /opt/backup/common.sh
    record_run "$1" "$(date -Iseconds)" "$2" "" "" "$3"
    if [ "$2" != "true" ]; then notify "Backup problem: $1" "$3"; fi
    ;;
  notify)
    source /opt/backup/common.sh
    notify "$1" "$2"
    ;;
  shell) exec bash ;;
  *)
    echo "jobs: snapshot [label] | yearly <FY> | restore-snapshot <file> <key> [--into-scratch|--replace-live] | list | record | notify | shell"
    ;;
esac
