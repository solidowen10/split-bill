# Shared Ledger — Split Bill

A self-hosted bill-splitting tool, built to run at `tool.selinnaowen.com/split-bill`.

No third-party SaaS, no fees — group creation, LINE Login, expense tracking,
and settlement math all run on your own server.

## How it works

1. Anyone visits the site and creates a group (no login needed to create one).
2. The creator (who becomes the group admin once they later join with LINE)
   adds placeholder names for everyone in the group.
3. The admin shares the invite link. Each person opens it, signs in with
   LINE, and taps which placeholder name is theirs — that slot is now
   permanently tied to their LINE account for this group.
4. Anyone who has joined can log expenses: what it was for, how much, who
   paid, and who it should be split between (everyone, or just a subset).
5. The admin clicks "Calculate split." The app computes everyone's balance
   and the minimum number of payments needed to settle up.
6. Either side of a payment can mark it "paid" once it's actually been sent.
7. When the group is done, the admin can **close** it (locked, read-only) or
   **reset entries** (wipes expenses but keeps the same member list, ready
   for a new round with the same people).

## Stack

Matches the camper tracker app's stack on purpose, so it's deployable the
same way:

- Node.js + Express
- SQLite via `better-sqlite3` (synchronous, file-based, zero external DB to manage)
- EJS server-rendered views (no build step, no React/Vue)
- `express-session` for cookie-based sessions
- LINE Login (OAuth 2.0) via direct API calls (no SDK dependency)
- PM2 for process management, Nginx as reverse proxy, AWS Lightsail to host

## Project layout

```
split-bill/
├── server.js              Entry point, mounts everything under BASE_PATH
├── db/
│   ├── schema.sql          Table definitions (auto-applied on boot)
│   ├── index.js            Production DB driver (better-sqlite3)
│   └── index.sandbox.js    Dev-only driver using node:sqlite — DO NOT DEPLOY
├── lib/
│   ├── settlement.js        Pure balance + minimal-transfer calculation logic
│   └── line-auth.js         LINE OAuth helper functions
├── routes/
│   ├── groups.js            Create group, admin setup, dashboard, close/reset
│   ├── auth.js               LINE login flow + claiming a member slot
│   ├── expenses.js           Add/delete expenses
│   ├── settlements.js        Calculate split, mark transfers paid
│   └── test-only-auth.js     Local-testing backdoor, gated by ENABLE_TEST_AUTH
├── views/                   EJS templates
├── public/css/style.css     All styling
└── test/                    Shell scripts that exercise the full flow end-to-end
```

## Setting up LINE Login (one-time)

You said you don't have a LINE Login Channel yet — here's how to create one:

1. Go to the [LINE Developers Console](https://developers.line.biz/console/)
   and log in with your LINE account.
2. Create a new **Provider** if you don't already have one (e.g. "Owen" or
   "Selinna Owen Tools") — a Provider is just a namespace that can hold
   multiple channels, in case you build more tools later.
3. Inside that provider, create a new **Channel** → choose **LINE Login**.
4. Fill in the basic channel info (app name, description, category — these
   are just shown to users on the consent screen).
5. Once created, go to the channel's **LINE Login** tab and add a callback
   URL: `https://tool.selinnaowen.com/split-bill/auth/line/callback`
   (You can add `http://localhost:3300/auth/line/callback` too, for local
   testing before you deploy.)
6. Under the **Basic settings** tab, copy the **Channel ID** and
   **Channel secret** — you'll put these in your `.env` file as
   `LINE_LOGIN_CHANNEL_ID` and `LINE_LOGIN_CHANNEL_SECRET`.
7. Under **OpenID Connect** / scopes, make sure `profile` is enabled (it
   usually is by default) — this is what lets the app read each user's
   display name and avatar.

That's it — no need to publish the channel for personal/friend-group use;
LINE Login channels work immediately for any LINE user once the callback
URL matches.

## Local development

```bash
cd split-bill
npm install
cp .env.example .env
# Fill in LINE_LOGIN_CHANNEL_ID and LINE_LOGIN_CHANNEL_SECRET in .env
# Leave BASE_PATH empty for local dev
npm start
```

Visit `http://localhost:3300`.

Note: `better-sqlite3` compiles a native module on install. If `npm install`
fails on your machine for that package specifically, you likely just need
build tools installed (`build-essential` on Debian/Ubuntu, Xcode command
line tools on macOS) — this is a one-time machine setup issue, not a code
issue.

## Production deployment (AWS Lightsail, matching the camper tracker setup)

1. **Copy the project to your Lightsail instance** (e.g. via `git`, `scp`,
   or `rsync`), somewhere like `/home/ubuntu/apps/split-bill`.

2. **Install dependencies:**
   ```bash
   cd /home/ubuntu/apps/split-bill
   npm install --production
   ```

3. **Create your production `.env`:**
   ```bash
   cp .env.example .env
   ```
   Then edit it:
   ```
   PORT=3300
   NODE_ENV=production
   BASE_PATH=/split-bill
   SESSION_SECRET=<run: openssl rand -hex 32>
   LINE_LOGIN_CHANNEL_ID=<from LINE Developers Console>
   LINE_LOGIN_CHANNEL_SECRET=<from LINE Developers Console>
   DB_PATH=/home/ubuntu/apps/split-bill/db/split-bill.db
   ```
   `BASE_PATH=/split-bill` is what makes every route, static asset, and
   redirect inside the app correctly prefix itself so the whole thing works
   when mounted at `tool.selinnaowen.com/split-bill` instead of at a domain
   root. You don't need to edit any route files for this — it's handled in
   `server.js` and every view/route already reads `basePath` consistently.

4. **Start it with PM2**, choosing a port that doesn't collide with the
   camper tracker app (adjust if 3300 is already taken on your instance):
   ```bash
   pm2 start server.js --name split-bill
   pm2 save
   ```

5. **Add an Nginx location block** inside your existing
   `tool.selinnaowen.com` server block (alongside whatever already proxies
   the camper tracker):
   ```nginx
   location /split-bill/ {
       proxy_pass http://127.0.0.1:3300/split-bill/;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_cache_bypass $http_upgrade;
   }
   ```
   Then reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

6. **Update the LINE Login Channel's callback URL** (if you only set the
   localhost one during initial setup) to:
   `https://tool.selinnaowen.com/split-bill/auth/line/callback`

7. Visit `https://tool.selinnaowen.com/split-bill` and create a test group
   to confirm LINE Login completes correctly end to end.

## Database backups

`better-sqlite3` writes to a single file (`db/split-bill.db`, plus WAL/SHM
files alongside it while running). To back it up, the simplest safe approach
is a nightly cron job that runs SQLite's own backup command rather than
copying the raw file while the app may be writing to it:

```bash
sqlite3 /path/to/split-bill.db ".backup '/path/to/backups/split-bill-$(date +%F).db'"
```

## A note on the test scripts

`test/e2e_test.sh` and `test/e2e_test2.sh` were used during development to
verify the full flow (group creation, LINE login simulation, custom-split
expenses, settlement math, paid-toggling, authorization checks, close/reopen,
and reset) without needing a real LINE account. They rely on
`routes/test-only-auth.js`, which is only mounted when `ENABLE_TEST_AUTH=1`
is set — it is never active otherwise, and you should never set that
variable in production. You can delete the `test/` folder and
`routes/test-only-auth.js` entirely once you're comfortable; nothing else
depends on them.

## Design notes

The visual language is a "shared ledger" theme — a warm paper background,
a serif display face (Fraunces) for amounts and headings paired with a
clean grotesk (Inter) for everything else, dashed receipt-style dividers
between line items, and a muted moss-green / clay-orange palette (green for
settled/calm states, terracotta for amounts still owed). It's meant to feel
like a shared notebook between friends rather than a fintech dashboard.
