#!/usr/bin/env bash
# TRIUMP AI — ship the latest version to your server and restart it.
#   TRIUMP_HOST=root@1.2.3.4 ./deploy/ship.sh       upload code + public/, npm ci, restart
#   TRIUMP_HOST=root@1.2.3.4 ./deploy/ship.sh env   also upload .env (adjusted for production)
# .env and data/ on the server are never overwritten (except .env in `env` mode).
# First-time server setup: see DEPLOY.md.
set -euo pipefail

HOST="${TRIUMP_HOST:?set TRIUMP_HOST, e.g. TRIUMP_HOST=root@your-server-ip}"
KEY="${TRIUMP_KEY:-$HOME/.ssh/id_ed25519}"
APP=/srv/triump
SSH=(ssh -i "$KEY" -o BatchMode=yes "$HOST")

cd "$(dirname "$0")/.."

echo "==> paket CLI"
npm run pack-cli >/dev/null 2>&1 || true

echo "==> upload"
rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" \
  --exclude '.env' --exclude 'data/' --exclude 'node_modules/' --exclude '_archive/' \
  --exclude 'assets/' --exclude 'docs/' --exclude 'cli/' --exclude '.DS_Store' --exclude '.git/' \
  ./ "$HOST:$APP/"

if [ "${1:-}" = "env" ]; then
  echo "==> .env untuk server"
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  # production domain; port 587 because many hosts (e.g. Hetzner) block outbound 465
  sed -e 's#^SITE_URL=.*#SITE_URL=${TRIUMP_SITE_URL:-https://triumpai.com}#' \
      -e 's#^SMTP_PORT=.*#SMTP_PORT=587#' \
      -e '/^X_REDIRECT_URI=/d' .env > "$tmp"
  scp -q -i "$KEY" -o BatchMode=yes "$tmp" "$HOST:$APP/.env"
fi

echo "==> dependency + restart"
"${SSH[@]}" "set -e; cd $APP; npm ci --omit=dev --no-audit --no-fund >/dev/null; mkdir -p data; chown -R triump:triump $APP; chmod 600 .env; chmod 700 data; systemctl restart triump; sleep 2; systemctl is-active triump"

echo "==> health"
"${SSH[@]}" "curl -sS -o /dev/null -w 'lokal %{http_code} dalam %{time_total}s\n' http://127.0.0.1:7474/api/me"
echo "==> selesai"
