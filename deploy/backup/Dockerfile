FROM postgres:17-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends age ca-certificates curl jq unzip \
 && rm -rf /var/lib/apt/lists/* \
 && arch="$(dpkg --print-architecture)" \
 && curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/rclone-current-linux-${arch}.zip" \
 && unzip -q /tmp/rclone.zip -d /tmp/rclone \
 && install -m 755 /tmp/rclone/rclone-*/rclone /usr/local/bin/rclone \
 && rm -rf /tmp/rclone /tmp/rclone.zip \
 && rclone version | head -1

COPY scripts/ /opt/backup/
RUN chmod 755 /opt/backup/*.sh

WORKDIR /opt/backup
ENTRYPOINT ["/opt/backup/entrypoint.sh"]
