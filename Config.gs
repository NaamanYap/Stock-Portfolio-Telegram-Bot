const Config = (() => {
  const PROPERTIES = PropertiesService.getScriptProperties();

  const REQUIRED_KEYS = Object.freeze([
    'GEMINI_API_KEY',
    'FINNHUB_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID'
  ]);

  const SHEETS = Object.freeze({
    portfolio: 'Portfolio',
    watchlist: 'Watchlist',
    logs: 'Logs',
    history: 'Portfolio History'
  });

  const DEFAULTS = Object.freeze({
    geminiModel: 'gemini-2.5-flash',
    marketDataProvider: 'FINNHUB',
    reportTimezone: Session.getScriptTimeZone() || 'America/New_York',
    maxNewsPerTicker: 6,
    cacheTtlSeconds: 900,
    maxRetries: 3,
    retryBaseMs: 750,
    // Finnhub's free tier allows 60 calls/minute. A run that fetches quote +
    // profile + metrics for every holding, watchlist item, and deep-dive
    // recommendation can easily burst past that within a few seconds of
    // Apps Script's much-faster execution speed - at which point every
    // subsequent call gets 429'd for the rest of that minute window, and
    // fetchJson's ~5s max retry backoff (maxRetries * retryBaseMs, roughly)
    // isn't long enough to outlast it. Spacing calls out proactively avoids
    // tripping the limit in the first place instead of reacting to it after
    // the fact. 1100ms gives ~54 calls/minute, a safety margin under 60.
    finnhubMinIntervalMs: 1100,
    alertMovePercent: 5,
    earningsWindowDays: 7,
    unusualVolumeRatio: 2,
    // Every value in the Mini App and the briefing's portfolio totals is
    // converted into this currency. Holdings keep their own currency in the
    // sheet; only the totals are converted.
    baseCurrency: 'USD',
    // How long a Mini App link stays valid. The daily run re-issues the chat's
    // menu button with a fresh link, so this only needs to outlast a few
    // missed runs.
    miniAppLinkDays: 30,
    // A Mini App "refresh" within this window returns the stored snapshot
    // instead of re-pricing everything, so hammering the button can't burn
    // through the Finnhub quota.
    snapshotMinRefreshSeconds: 120,
    // The Logs sheet gets a row per event; without a cap it grows until the
    // spreadsheet hits its cell limit.
    maxLogRows: 3000
  });

  function get(key, fallback) {
    const value = PROPERTIES.getProperty(key);
    return value === null || value === '' ? fallback : value;
  }

  function requireValue(key) {
    const value = get(key);
    if (!value) {
      throw new Error(`Missing Script Property: ${key}`);
    }
    return value;
  }

  function validate() {
    const missing = REQUIRED_KEYS.filter((key) => !get(key));
    if (missing.length) {
      throw new Error(`Missing required Script Properties: ${missing.join(', ')}`);
    }
  }

  function spreadsheet() {
    const spreadsheetId = get('SPREADSHEET_ID');
    return spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();
  }

  function all() {
    return {
      sheets: SHEETS,
      geminiModel: get('GEMINI_MODEL', DEFAULTS.geminiModel),
      marketDataProvider: get('MARKET_DATA_PROVIDER', DEFAULTS.marketDataProvider),
      reportTimezone: get('REPORT_TIMEZONE', DEFAULTS.reportTimezone),
      maxNewsPerTicker: DEFAULTS.maxNewsPerTicker,
      cacheTtlSeconds: DEFAULTS.cacheTtlSeconds,
      maxRetries: DEFAULTS.maxRetries,
      retryBaseMs: DEFAULTS.retryBaseMs,
      finnhubMinIntervalMs: DEFAULTS.finnhubMinIntervalMs,
      alertMovePercent: DEFAULTS.alertMovePercent,
      earningsWindowDays: DEFAULTS.earningsWindowDays,
      unusualVolumeRatio: DEFAULTS.unusualVolumeRatio,
      baseCurrency: String(get('BASE_CURRENCY', DEFAULTS.baseCurrency)).trim().toUpperCase(),
      miniAppLinkDays: Number(get('MINI_APP_LINK_DAYS', DEFAULTS.miniAppLinkDays)),
      snapshotMinRefreshSeconds: DEFAULTS.snapshotMinRefreshSeconds,
      maxLogRows: DEFAULTS.maxLogRows
    };
  }

  function set(key, value) {
    PROPERTIES.setProperty(key, value);
  }

  function remove(key) {
    PROPERTIES.deleteProperty(key);
  }

  function properties() {
    return PROPERTIES;
  }

  return {
    get,
    set,
    remove,
    properties,
    requireValue,
    validate,
    spreadsheet,
    all
  };
})();
