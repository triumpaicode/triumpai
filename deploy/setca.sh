#!/usr/bin/env bash
# TRIUMP AI — pasang CA token dalam hitungan detik.
#   ./deploy/setca.sh 0xABC...            -> tulis CA ke public/config.js + kirim ke server + cek live
#   ./deploy/setca.sh 0xABC... --local    -> hanya ubah file lokal (untuk tes)
# Hanya config.js yang dikirim: tanpa restart, situs langsung pakai CA baru
# (config.js disajikan no-cache, cek holder membaca file ini tiap kali).
set -euo pipefail

CA="${1:-}"
HOST="${TRIUMP_HOST:?set TRIUMP_HOST=root@your-server}"
KEY="${TRIUMP_KEY:-$HOME/.ssh/id_ed25519}"
APP=/srv/triump
SITE="${TRIUMP_SITE_URL:-https://triumpai.com}"

cd "$(dirname "$0")/.."

CA="$(printf '%s' "$CA" | tr -d '[:space:]')"
if ! [[ "$CA" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "CA tidak valid: '$CA' (harus 0x + 40 karakter hex)"; exit 1
fi

sed -i '' -E "s#^window\.TRIUMP_CA = \"[^\"]*\";#window.TRIUMP_CA = \"$CA\";#" public/config.js
grep -q "window.TRIUMP_CA = \"$CA\";" public/config.js || { echo "gagal menulis config.js"; exit 1; }
echo "==> config.js lokal: $CA"

[ "${2:-}" = "--local" ] && exit 0

scp -q -i "$KEY" -o BatchMode=yes public/config.js "$HOST:$APP/public/config.js"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "chown triump:triump $APP/public/config.js"

if curl -fsS "$SITE/config.js?t=$(date +%s)" | grep -q "$CA"; then
  echo "==> LIVE di $SITE"
else
  echo "!! config.js live belum berisi CA, cek manual"; exit 1
fi

cat <<EOF

Tombol Buy sekarang:
  Fomo : https://fomo.family/tokens/robinhood/$CA
  Pons : https://ponsfamily.com/launchpad/$CA

Bio X:
Describe it. AI builds it. ⚡ Studio designs it · TriumpCode codes it · \$TRIUMPAI on Robinhood Chain
CA: $CA
EOF
