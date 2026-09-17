#!/bin/bash
# One-time preparation of a fresh Oracle Cloud VM (Oracle Linux 8/9 or Ubuntu 22.04/24.04).
# Safe to re-run: every step checks what is already done.
#
#   sudo bash setup-server.sh --domain billing.example.com --email owner@example.com [--ssh-from 203.0.113.7]
set -euo pipefail

DOMAIN="" EMAIL="" SSH_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --ssh-from) SSH_FROM="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "--domain and --email are required" >&2; exit 2; }

ROOT=/opt/billing
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGIN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
. /etc/os-release
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step "Time zone → Asia/Kolkata"
timedatectl set-timezone Asia/Kolkata

step "System packages and automatic security updates"
case "$ID" in
  ol|rhel|centos|rocky|almalinux)
    PKG=dnf
    dnf -y install dnf-utils curl jq rsync tar openssl
    dnf -y install "oracle-epel-release-el${VERSION_ID%%.*}" 2>/dev/null || dnf -y install epel-release || true
    dnf -y install fail2ban fail2ban-firewalld dnf-automatic || dnf -y install fail2ban dnf-automatic
    sed -i 's/^apply_updates *=.*/apply_updates = yes/; s/^upgrade_type *=.*/upgrade_type = security/' /etc/dnf/automatic.conf
    systemctl enable --now dnf-automatic.timer
    ;;
  ubuntu|debian)
    PKG=apt
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get -y install ca-certificates curl jq rsync openssl fail2ban unattended-upgrades iptables-persistent
    dpkg-reconfigure -f noninteractive unattended-upgrades
    ;;
  *) echo "Unsupported OS: $ID" >&2; exit 1 ;;
esac

step "Docker"
if ! command -v docker >/dev/null; then
  if [ "$PKG" = dnf ]; then
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || cat >/etc/docker/daemon.json <<'JSON'
{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
JSON
systemctl enable --now docker
systemctl restart docker

step "Firewall: allow web traffic (80, 443)"
if [ "$PKG" = dnf ] && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --permanent --add-port=443/udp
  firewall-cmd --reload
elif command -v iptables >/dev/null; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport $port -m state --state NEW -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport $port -m state --state NEW -j ACCEPT
  done
  iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null && netfilter-persistent save
fi

step "SSH: keys only, no root login"
AUTH_KEYS="$(getent passwd "$LOGIN_USER" | cut -d: -f6)/.ssh/authorized_keys"
if [ -s "$AUTH_KEYS" ]; then
  cat >/etc/ssh/sshd_config.d/10-billing.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 4
LoginGraceTime 30
CONF
  if [ -n "$SSH_FROM" ]; then
    echo "AllowUsers ${LOGIN_USER}@${SSH_FROM}" >>/etc/ssh/sshd_config.d/10-billing.conf
  fi
  grep -q '^Include /etc/ssh/sshd_config.d/\*.conf' /etc/ssh/sshd_config \
    || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
  sshd -t && (systemctl reload sshd 2>/dev/null || systemctl reload ssh)
else
  echo "Skipped: no SSH key found for $LOGIN_USER, so password login stays on to avoid locking you out."
fi

step "Block repeated SSH login attempts (fail2ban)"
cat >/etc/fail2ban/jail.d/billing.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

step "Swap file (protects against running out of memory during builds)"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

step "Folders and secrets"
mkdir -p "$ROOT"/{app,state}
install -d -m 700 "$ROOT/secrets" "$ROOT/restore"
gen() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40; }
if [ ! -f "$ROOT/.env" ]; then
  sed -e "s/^APP_DOMAIN=.*/APP_DOMAIN=${DOMAIN}/" \
      -e "s/^ACME_EMAIL=.*/ACME_EMAIL=${EMAIL}/" \
      -e "s/^ALERT_EMAIL_TO=.*/ALERT_EMAIL_TO=${EMAIL}/" \
      -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(gen)/" \
      -e "s/^APP_SECRET=.*/APP_SECRET=$(gen)$(gen)/" \
      -e "s/^PITR_CIPHER_PASS=.*/PITR_CIPHER_PASS=$(gen)/" \
      "$HERE/../env.example" >"$ROOT/.env"
  echo "Created $ROOT/.env with fresh random secrets."
else
  sed -i "s/^APP_DOMAIN=.*/APP_DOMAIN=${DOMAIN}/; s/^ACME_EMAIL=.*/ACME_EMAIL=${EMAIL}/" "$ROOT/.env"
fi
chown root:root "$ROOT/.env" && chmod 600 "$ROOT/.env"

step "billing command and scheduled jobs"
ln -sf "$ROOT/app/deploy/server/billing.sh" /usr/local/bin/billing
chmod 755 "$ROOT/app/deploy/server/billing.sh" 2>/dev/null || true
install -m 644 "$HERE"/systemd/billing-job@.service /etc/systemd/system/
for t in "$HERE"/systemd/billing-*.timer; do install -m 644 "$t" /etc/systemd/system/; done
systemctl daemon-reload
for t in "$HERE"/systemd/billing-*.timer; do systemctl enable --now "$(basename "$t")"; done

usermod -aG docker "$LOGIN_USER" || true

cat <<DONE

✔ Server prepared.

Still to do in the Oracle Cloud console (the script can't change these):
  1. Networking → your VCN → Security List: add ingress rules for TCP 80 and TCP 443 from 0.0.0.0/0.
  2. DNS: point ${DOMAIN} (A record) at this server's public IP.
Then deploy the app:  sudo billing deploy
DONE
