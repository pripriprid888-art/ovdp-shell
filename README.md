# OVDP Shell

Desktop app for comparing and buying Ukrainian government bonds (ОВДП) across **Inzhur**, **UNIVER**, and **Privat24** in one place.

Built with [Electron](https://www.electronjs.org/). The embedded browser keeps separate sessions per platform; the cabinet panel shows a merged catalog, portfolio, calculator, and buy flows.

## Features

- **Unified catalog** — scan and merge bond listings from all three platforms (by ISIN)
- **Portfolio** — positions and UNIVER orders
- **Buy drawer** — quantity, price estimate, auto-route or automated buy (UNIVER; Privat opens purchase page + account selection)
- **Session status** — per-platform login indicators in the toolbar
- **Bond calculator** — YTM / SIM, coupons, totals
- **Automation log** — sign-in, scan, and buy steps in «Журнал дій»

## Requirements

- **Node.js** 18+ (20+ recommended)
- **npm**
- **macOS** (primary target; Electron should run on Windows/Linux but is not tested here)

## Install & run

```bash
git clone <your-repo-url>
cd "electron ovdp"   # or your clone folder name
npm install
npm start
```

## First-time setup

1. Open **Особисті дані** in the cabinet and enable the platforms you use.
2. Save **phone / login and password** for each site (stored locally, encrypted when macOS Keychain is available).
3. For **Privat24**, add payment card/account numbers used for bond purchases.
4. Use toolbar buttons to sign in on each platform, then run **Сканувати** on the catalog.

UNIVER catalog scan requires an active UNIVER session. Privat24 catalog works in guest mode for listings; buy and portfolio need login.

## User data (not in git)

App state lives outside the project folder:

| macOS | `~/Library/Application Support/inzhur-shell/` |
|-------|-----------------------------------------------|

Includes encrypted credentials, onboarding settings, cached `securities.json`, and browser partition cookies (sessions). **Do not commit or share this folder.**

After cloning on a new machine, run the app and enter credentials again in **Особисті дані**.

## Project layout

```
src/
  main.js           Electron main process, IPC, scans
  preload.js        Renderer ↔ main bridge
  shell.html        Cabinet UI shell
  bond-list.js      Catalog / portfolio lists
  desk-ui.js        Buy drawer, balance strip
  scanners/         Inzhur, UNIVER, Privat catalog & portfolio
  automation/       Sign-in, purchase routes, UNIVER buy
  session/          Session verification per site
  credentials/      Local credential store
assets/             App icon
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run the app |
| `npm run dev` | Same as `npm start` |
| `npm run pack` | Unpacked `.app` in `dist/mac-*` (quick smoke test) |
| `npm run dist:mac` | macOS **DMG** + **ZIP** in `dist/` |
| `npm run dist:win` | Windows **NSIS** installer (`dist/OVDP-Shell-Setup-<version>.exe`) |

### macOS installer

```bash
npm install
cp .env.production.example .env.production   # fill Neon / AWS vars for the shipped app
npm run dist:mac
```

`predist:mac` copies `.env.production` (or `.env` if production is missing) into the app as `Contents/Resources/.env`. The packaged app loads that on startup (`src/config/load-env.js`).

Open `dist/OVDP Shell-<version>.dmg`, drag **OVDP Shell** to Applications.

The build is **unsigned** unless you configure Apple code signing (`CSC_LINK` / `CSC_KEY_PASSWORD` in the environment). Unsigned builds may show Gatekeeper “cannot be opened” — right‑click → Open, or System Settings → Privacy & Security → Open Anyway.

### Windows installer

```bash
npm install
npm run dist:win
```

This uses the same bundled env as the macOS build (`.env.production`, or `.env`). The installer is `dist/OVDP-Shell-Setup-<version>.exe` (NSIS, per-user by default, install folder can be changed, desktop and Start menu shortcuts).

Building the `.exe` on macOS needs [Wine](https://www.winehq.org/). On Windows, `npm run dist:win` is enough. The installer is unsigned unless you set a Windows code-signing certificate (`CSC_LINK` / `WIN_CSC_LINK`).

User data after install is `%APPDATA%\inzhur-shell`.

**Security:** bundled env contains live credentials — anyone can extract them from the `.dmg`. Use Neon branch credentials with least privilege; never ship production DB keys you cannot rotate.

User data after install is still `~/Library/Application Support/inzhur-shell/` (same as dev).

## Neon (action log / history)

**Журнал дій** is shown from local `action-log.json` (full detail including expandable context). Each new entry is also **inserted into Postgres** (`action_log_entries`) when `DATABASE_URL` is set — **without** `context` (only `id`, `at`, `level`, `site_id`, `message`, `kind`, `category`, `run_id`, `error_message`).

Apply the table once: `npm run db:schema` (uses `scripts/neon-schema.sql`).

One-time project setup (from repo root):

```bash
npm i -g neon@latest && neon login   # or use `npx neon` without global install
npx neon skills -y
npx neon mcp -y                      # optional: Neon MCP in Cursor
npx neon link --project-id polished-smoke-90919972 --branch production
npx neon config init                 # installs @neon/env; keeps existing neon.ts
npm run neon:deploy                  # provisions buckets, refreshes .env AWS_* vars
```

`neon.ts` declares the bucket:

```ts
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  buckets: {
    "ovdp-history": { access: "private" },
  },
});
```

After `neon link` / `neon deploy`, `.env` contains `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION` (gitignored). Restart the app so the main process loads them.

Optional Postgres (`DATABASE_URL`) and `npm run db:ping` remain for SQL use; **logs use Object Storage**, not Postgres.

**Do not** commit `.env` or put broker passwords in Neon.

## Security

- Treat this repo as **private** if it documents your automation workflow for bank/broker sites.
- Never commit `.env`, `credentials.dat`, `onboarding.json`, `securities.json`, or files from Application Support.
- Passwords stay on your machine; they are not sent to any server except the platforms you log into.

## License

Private / unlicensed
