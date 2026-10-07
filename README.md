# Portfolio Intelligence Bot

Reads a Google Sheets portfolio, fetches market data and company news, asks
Gemini for a daily briefing, and sends it to Telegram every weekday at 7 AM.
It also serves a **Telegram Mini App** with your total portfolio value across
every market (US, Singapore, Hong Kong, crypto, cash…) in one base currency,
and answers commands like `/portfolio` in the chat.

This is one of two projects. Stock recommendations now live in its companion,
**Deep Dive Screener**, which runs weekly with its own API keys and its own
Telegram bot. See [Where the recommendations went](#where-the-recommendations-went).

## Features

- Reads holdings from a `Portfolio` sheet.
- Retrieves quote, daily change, market cap, P/E, 52-week high/low, volume, and
  next earnings date.
- Retrieves, deduplicates, and ranks recent company news.
- Detects alerts for price moves, upcoming earnings, analyst/news events,
  dividends, SEC filing mentions, and unusual volume.
- Generates an AI briefing: company updates, macro overview, risks,
  opportunities, and upcoming earnings.
- Sends it through your Telegram bot, headed by a portfolio summary (total
  value, today's change, split by market) computed from market data. Gemini
  writes the narrative only: price changes it reports are overwritten with the
  real figures, and updates for tickers you don't hold are dropped.
- Prices holdings on any exchange, crypto and cash, and converts everything into
  one base currency (`BASE_CURRENCY`, default USD).
- Telegram Mini App: total value, today's move, all-time P/L, value over time,
  allocation by market / asset class / currency, and per-holding details. A
  Briefing tab shows the latest AI briefing: why each holding moved, its
  outlook, risks and headlines, macro snapshot, today's risks and
  opportunities. It updates each time a briefing runs, not when you tap
  Refresh.
- Bot commands: `/portfolio`, `/markets`, `/top`, `/app`, `/refresh`, `/briefing`.
- Tells you in Telegram when a scheduled run fails.
- Logs executions, errors, token usage, and API usage to a `Logs` sheet (capped
  at ~3,000 rows).
- Installs weekday 7 AM triggers, plus an hourly re-pricing trigger.

## Where the recommendations went

The `🙈 Stock Recommendations` section moved to the **Deep Dive Screener**
project. Reasons, briefly:

**Rate limits.** Finnhub's free tier allows 60 calls/minute per key. The screen
needs ~150 calls; this briefing needs ~4 per holding plus news. Separate keys
means the screen can never rate-limit your morning briefing.

**Execution time.** Apps Script kills a run at ~6 minutes. Sharing one run
forced the screen down to 4 stocks per sector, leaving 22 names in its universe
permanently unreachable.

**Cadence.** The screen ranks on trailing P/E, ROE, margins and revenue growth —
all quarterly figures. It produced near-identical picks five days a week. It now
runs weekly, which is honest about how fast the underlying data actually moves.

Nothing else about this briefing changed.

## Required APIs

1. **Finnhub** — quotes, profile, metrics, earnings calendar, news.
   Script Property: `FINNHUB_API_KEY`
2. **Gemini** — the briefing. Script Property: `GEMINI_API_KEY`.
   Optional: `GEMINI_MODEL` (defaults to `gemini-2.5-flash`).
3. **Telegram** — a bot from [@BotFather](https://t.me/BotFather).
   Script Properties: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
4. **Yahoo Finance** (no key) — prices for non-US listings and crypto, which
   Finnhub's free tier doesn't cover. This is an unofficial endpoint: if it
   stops answering, those holdings show as unpriced until it's back, and you can
   fill in `Manual Price` meanwhile.
5. **open.er-api.com** (no key) — daily FX rates for the currency conversion.

Optional Script Properties:

| Property | Default | Purpose |
|---|---|---|
| `BASE_CURRENCY` | `USD` | Currency for totals, e.g. `SGD`. |
| `WEBAPP_URL` | — | The web app's `/exec` URL. Needed for the Mini App and commands. |
| `MINI_APP_LINK_DAYS` | `30` | How long a Mini App link stays valid. |
| `DASHBOARD_API_KEY` | — | Shared secret that lets the Stock Finder dashboard read this portfolio (its Portfolio tab). Unset = off. |

Use **different** keys here from the Deep Dive Screener. Sharing a Finnhub key
across both defeats the separation.

A Script Property **overrides** the matching default in `Config.gs`. If editing
the code seems to do nothing, run `logResolvedConfig` — it prints what the
script actually resolved and which properties are set. (It reports secrets only
as `set`/`MISSING`, never their values.)

## Sheet Schemas

### Portfolio

| Ticker | Company Name | Shares | Average Cost | Sector | Notes | Asset Class | Market | Currency | Manual Price |
|---|---|---:|---:|---|---|---|---|---|---:|
| AAPL | Apple Inc. | 15 | 165.25 | Information Technology | Core holding | | | | |
| D05.SI | DBS Group | 100 | 33.50 | Financials | | | | | |
| 0700.HK | Tencent | 50 | 320 | Communication Services | | | | | |
| BTC | Bitcoin | 0.05 | 42000 | Crypto | | Crypto | | | |
| SGD | SGD cash | 5000 | | Cash | Emergency fund | Cash | | SGD | |

The last four columns are optional and are added to an existing sheet by
`installPortfolioIntelligenceBot`. Leave them blank for US stocks.

- **Ticker** — use Yahoo-style exchange suffixes for non-US listings: `.SI`
  Singapore, `.HK` Hong Kong, `.L` London, `.T` Tokyo, `.TO` Toronto, `.AX`
  Australia, `.DE`/`.PA`/`.AS` Europe, `.TA` Tel Aviv, and so on. The suffix
  sets the market and currency. Plain tickers are US listings (`BRK.B` works).
- **Asset Class** — `Stock` (default), `ETF`, `Fund`, `Bond`, `Crypto`, `Cash`
  or `Other`. For crypto, the ticker is the coin (`BTC`) or a pair (`ETH-USD`).
- **Market** — overrides the inferred market name used for grouping.
- **Currency** — overrides the inferred currency. For cash, it's the cash's
  currency, and `Shares` is the amount.
- **Manual Price** — used instead of any feed, for things no feed can price.
- **Average Cost** is in the holding's own currency. London prices quoted in
  pence are converted to pounds automatically.

### Watchlist

Not used by the briefing. Kept for the Deep Dive Screener (see below).

| Ticker | Company Name | Sector | Notes |
|---|---|---|---|
| NVDA | NVIDIA Corporation | Information Technology | AI infrastructure |

### Portfolio History

Created automatically. One row per day with the day's latest total in the base
currency; the Mini App's value-over-time chart reads it, so the chart starts
filling in from the day you install.

### Logs

Created automatically:

| Timestamp | Level | Event | Details | Execution Ms | API Usage | Tokens Used | Last Successful Run |
|---|---|---|---|---:|---|---:|---|

> The Deep Dive Screener can read `Portfolio` and `Watchlist` from this same
> spreadsheet (set its `SPREADSHEET_ID`) so it doesn't recommend names you
> already own. That access is read-only and optional.

## Project Files

- `Config.gs` — Script Properties, sheet names, defaults.
- `Portfolio.gs` — portfolio and watchlist readers, example seeding.
- `MarketData.gs` — market data facade and Finnhub provider.
- `News.gs` — news retrieval, deduplication, filtering, ranking.
- `Alerts.gs` — deterministic alert detection.
- `Gemini.gs` — Gemini integration and response schema.
- `Telegram.gs` — message rendering, chunking, delivery.
- `Scheduler.gs` — weekday and hourly trigger installation.
- `Markets.gs` — market/currency classification, Yahoo pricing, FX conversion.
- `Snapshot.gs` — portfolio valuation in the base currency, latest-snapshot
  store, daily history.
- `Briefing.gs` — stores the latest AI briefing for the Mini App.
- `MiniApp.gs` — web app entry points (`doGet`/`doPost`), signed Mini App links.
- `MiniAppPage.html` — the Mini App page.
- `Bot.gs` — Telegram webhook, commands, menu button.
- `Utilities.gs` — HTTP, retries, dates, cache, sheet helpers.
- `Logger.gs` — sheet-backed operational logs.
- `Main.gs` — entry points.
- `appsscript.json` — manifest and OAuth scopes.

## Public Entry Points

- `installPortfolioIntelligenceBot()` — validates properties, seeds example
  sheets if empty, installs weekday 7 AM triggers.
- `runDailyPortfolioIntelligence()` — runs the briefing and sends it. Apps
  Script stops any execution at 6 minutes, so when a large portfolio won't
  fit, the run stops cleanly and resumes a minute later in a new execution
  (`continueDailyBriefing`, up to 3 times). Data fetched before the stop is
  served from cache, so nothing is fetched twice. The Logs sheet shows
  "Daily briefing continues in a new execution" when this happens.
- `seedExampleSpreadsheet()` — adds example rows if the sheets are empty.
- `installTelegramBot()` — registers the webhook, command menu and Mini App
  menu button. Run after setting `WEBAPP_URL`.
- `refreshPortfolioSnapshot()` — re-prices holdings (the hourly trigger).
- `logMiniAppLink()` — prints a fresh Mini App link for a desktop browser.
- `resetMiniAppLinks()` — revokes every Mini App link issued so far.
- `logResolvedConfig()` — prints resolved settings and property overrides.

## Setting up the Mini App and commands

1. Push the code (including `MiniAppPage.html`) and run
   `installPortfolioIntelligenceBot` once.
2. In the Apps Script editor: **Deploy → New deployment → Web app**. Execute
   as **Me**, access **Anyone**. (Telegram opens the page without a Google
   sign-in, so it must be public; the data is protected by signed links instead.)
3. Copy the `/exec` URL into the Script Property `WEBAPP_URL`.
4. Run `installTelegramBot`. This points the bot's webhook at the web app,
   registers the `/` command menu, and sets the chat's menu button to open the
   Mini App.
5. Open the chat with your bot: tap **Portfolio** next to the message box, or
   send `/app`.

When you change code later, use **Deploy → Manage deployments → Edit → New
version** so the `/exec` URL stays the same. A brand-new deployment gets a new
URL, and you'd have to update `WEBAPP_URL` and re-run `installTelegramBot`.

**How the page is protected.** Apps Script serves the page inside a Google
iframe, which can't see the login data Telegram passes to Mini Apps. Instead,
every link the bot sends carries a signed token that expires after
`MINI_APP_LINK_DAYS`. The daily run renews the menu button's link. Links only go
to `TELEGRAM_CHAT_ID`, and commands from any other chat are ignored. If a link
leaks, run `resetMiniAppLinks`.

The web app is public, so any top-level function in the project can be called
through it by someone who has the `/exec` URL. The data functions check the
token. Internal helpers end in `_`, which hides them from callers. The one
expensive entry point, the briefing, won't run twice within 5 minutes.

**Why the numbers can lag.** Pricing is rate-limited to about one Finnhub call
per second, which is too slow to do each time the page opens. So the page shows
the latest stored snapshot, written by the daily briefing, the hourly trigger,
`/refresh`, or the page's refresh button (at most one re-price every 2 minutes).
"Today" is each asset's own move in its local currency, converted at the
current FX rate. Moves in the exchange rates themselves aren't counted in it.

**Stock Finder dashboard.** The Stock Finder website shows this portfolio
in its own Portfolio tab. Its server calls `/exec?api=data` (or `api=refresh`)
with `key=<DASHBOARD_API_KEY>` and gets the same JSON the Mini App reads. Set
the same random string as `DASHBOARD_API_KEY` here and `PORTFOLIO_API_KEY` on
Stock Finder, plus `PORTFOLIO_API_URL=<the /exec URL>` there. Change the
property to cut it off. The key only travels server to server.

**Webhook note.** Apps Script answers every POST with a redirect, and Telegram
may count that as a failed delivery and send it again. The bot handles each
update once, so this is harmless, but `getWebhookInfo` may show a "302" error.

## Scheduling

Run `installPortfolioIntelligenceBot` once. It installs five triggers, Monday
to Friday at 7 AM in the manifest timezone (`appsscript.json`), plus one hourly
`refreshPortfolioSnapshot` trigger. It removes existing ones first, so running
it again never creates duplicates. The hourly trigger costs one quote call per
holding.

Apps Script fires time-based triggers within an hour window, so expect
8:00–9:00 rather than 8:00 exactly. To stop them, delete them from the Triggers
panel (clock icon) in the editor.

## Extension Points

To swap market providers, add another provider object in `MarketData.gs` and
route it from `getProvider()` via the `MARKET_DATA_PROVIDER` property.

To add another delivery channel, create e.g. `Slack.gs`, accept the same
`report` object `Telegram.sendDailyBriefing` takes, and call it from `Main.gs`.

To add new data sources (SEC filings, insider trades, options, FX), keep the
source-specific calls in their own file and add a summarised representation to
`buildReportInput()`.

## A note on logging

`Utils.redactUrl` masks `token=` and `key=` query parameters before any URL
reaches the logs. Finnhub passes its API key as a query parameter, so an
unredacted URL in the `Logs` sheet or Stackdriver is a leaked credential.
