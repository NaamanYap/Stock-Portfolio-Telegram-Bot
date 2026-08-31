# Portfolio Intelligence Bot

Reads a Google Sheets portfolio, fetches market data and company news, asks
Gemini for a daily briefing, and sends it to Telegram every weekday at 8 AM.

This is one of two projects. Stock recommendations now live in its companion,
**Deep Dive Screener**, which runs weekly with its own API keys and its own
Telegram bot. See [Where the recommendations went](#where-the-recommendations-went).

## Features

- Reads holdings from a `Portfolio` sheet and tickers from a `Watchlist` sheet.
- Retrieves quote, daily change, market cap, P/E, 52-week high/low, volume, and
  next earnings date.
- Retrieves, deduplicates, and ranks recent company news.
- Detects alerts for price moves, upcoming earnings, analyst/news events,
  dividends, SEC filing mentions, and unusual volume.
- Generates an AI briefing: company updates, macro overview, risks,
  opportunities, upcoming earnings, and watchlist notes.
- Sends it through your Telegram bot.
- Logs executions, errors, token usage, and API usage to a `Logs` sheet.
- Installs weekday 8 AM triggers.

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

Use **different** keys here from the Deep Dive Screener. Sharing a Finnhub key
across both defeats the separation.

A Script Property **overrides** the matching default in `Config.gs`. If editing
the code seems to do nothing, run `logResolvedConfig` — it prints what the
script actually resolved and which properties are set. (It reports secrets only
as `set`/`MISSING`, never their values.)

## Sheet Schemas

### Portfolio

| Ticker | Company Name | Shares | Average Cost | Sector | Notes |
|---|---|---:|---:|---|---|
| AAPL | Apple Inc. | 15 | 165.25 | Information Technology | Core holding |

### Watchlist

| Ticker | Company Name | Sector | Notes |
|---|---|---|---|
| NVDA | NVIDIA Corporation | Information Technology | AI infrastructure |

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
- `Scheduler.gs` — weekday trigger installation.
- `Utilities.gs` — HTTP, retries, dates, cache, sheet helpers.
- `Logger.gs` — sheet-backed operational logs.
- `Main.gs` — entry points.
- `appsscript.json` — manifest and OAuth scopes.

## Public Entry Points

- `installPortfolioIntelligenceBot()` — validates properties, seeds example
  sheets if empty, installs weekday 8 AM triggers.
- `runDailyPortfolioIntelligence()` — runs the briefing and sends it.
- `seedExampleSpreadsheet()` — adds example rows if the sheets are empty.
- `logResolvedConfig()` — prints resolved settings and property overrides.

## Scheduling

Run `installPortfolioIntelligenceBot` once. It installs five triggers, Monday
to Friday at 8 AM in the manifest timezone (`appsscript.json`), and removes any
existing ones first so re-running never duplicates them.

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
