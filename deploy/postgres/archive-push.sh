#!/bin/sh
# Called by PostgreSQL for every finished change-log (WAL) segment.
# Until Object Storage is configured we acknowledge segments without shipping them,
# so the disk never fills up; nightly snapshots still protect the data meanwhile.
if [ -z "${PGBACKREST_REPO1_S3_BUCKET}" ] || [ -z "${PGBACKREST_REPO1_S3_KEY}" ]; then
  exit 0
fi
if [ ! -f /var/lib/postgresql/data/.pitr-enabled ]; then
  # Stanza not created yet (see pitr.sh setup).
  exit 0
fi
exec pgbackrest --stanza=main archive-push "$1"
