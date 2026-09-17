FROM postgres:17-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest \
 && chown -R postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest

COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY archive-push.sh pitr.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/archive-push.sh /usr/local/bin/pitr.sh \
 && chmod 644 /etc/pgbackrest/pgbackrest.conf
