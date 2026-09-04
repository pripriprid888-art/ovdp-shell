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
  sidepanel.js      Catalog / portfolio lists
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

## Security

- Treat this repo as **private** if it documents your automation workflow for bank/broker sites.
- Never commit `.env`, `credentials.dat`, `onboarding.json`, `securities.json`, or files from Application Support.
- Passwords stay on your machine; they are not sent to any server except the platforms you log into.

## License

Private / unlicensed
