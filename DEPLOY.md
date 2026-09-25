# Deploying TRIUMP AI

This guide takes a fresh Ubuntu server to a live HTTPS site. Node runs the app on `127.0.0.1:7474`, and Caddy serves it on ports 80/443 with automatic certificates over IPv4 and IPv6.

## 1. DNS

At your domain registrar, point the domain at the server:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | your server's IPv4 | 300 |
| AAAA | `@` | your server's IPv6 | 300 |
| CNAME | `www` | `your-domain.com` | 300 |

Keep any existing MX / TXT / DKIM records. Your email depends on them.

## 2. Server (one time)

```bash
# Node 24 and Caddy
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
apt-get install -y caddy

# a system user with no login shell, and the app folder
useradd --system --home /srv/triump --shell /usr/sbin/nologin triump
mkdir -p /srv/triump/data && chown -R triump:triump /srv/triump
```

## 3. Service

Copy `deploy/triump.service` to `/etc/systemd/system/triump.service`, then:

```bash
systemctl daemon-reload && systemctl enable triump
```

## 4. Caddy

Append `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, replacing `triumpai.com` with your domain:

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

Use `reload`, not `restart`, so other sites on the same server stay up.

## 5. Ship

From your machine, in the repo folder, with `.env` filled in:

```bash
TRIUMP_HOST=root@YOUR_SERVER_IP TRIUMP_SITE_URL=https://your-domain.com ./deploy/ship.sh env
```

This uploads the code, writes a production `.env`, runs `npm ci`, restarts the service and prints a health check. Leave out `env` on later deploys so the server's `.env` stays as it is.

## 6. Check

```bash
curl -I https://your-domain.com          # 200
curl -I https://www.your-domain.com      # 301 -> apex
journalctl -u triump -n 20               # "SMTP ready · AI ready · X ready" (printed in Indonesian: "SMTP siap · AI siap · X siap")
```

## 7. Launch day: set the token contract

```bash
TRIUMP_HOST=root@YOUR_SERVER_IP ./deploy/setca.sh 0xYOUR_TOKEN_CONTRACT
```

This writes the address into `public/config.js`, uploads only that file (no restart), and checks that the live site serves it. The Buy buttons, the CA strip and the holder check all start using it right away.

## 8. Optional: Google account picker

In Google Cloud Console, create an OAuth client ID of type **Web application** with `https://your-domain.com` as an authorized JavaScript origin. Put the client ID (not the secret) in `window.TRIUMP_GOOGLE_CLIENT_ID` in `public/config.js`. The sign-in popup then lists the Google accounts in the browser. The site only reads the email address, and sign-in is still confirmed with a one-time code.

## Gotchas

- **Email on port 465 may be blocked.** Many hosts, Hetzner included, block outbound port 465, so `ship.sh env` sets `SMTP_PORT=587` (STARTTLS).
- **X sign-in:** in the X developer portal, the callback URL must be exactly `https://your-domain.com/api/x/callback`.
- **Costs:** set a monthly spend limit in the Anthropic Console. Each Studio design is one long generation.
- **Backups:** everything user-created lives in `/srv/triump/data`, so back up that folder.
