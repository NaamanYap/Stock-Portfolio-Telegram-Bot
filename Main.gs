/*
 * Execution time budget. Apps Script kills a run at 6 minutes, and a briefing
 * makes ~5 Finnhub calls per holding paced at ~1/second, plus news and a
 * Gemini call - a large portfolio doesn't fit. So the run works against a
 * deadline: when time runs short it stops cleanly and schedules
 * continueDailyBriefing, which starts over in a fresh execution. Everything
 * already fetched is served from cache (and cache hits aren't paced), so the
 * continuation gets through the data in seconds and picks up where the last
 * one stopped.
 */
const RUN_LIMIT_MS = 6 * 60 * 1000;
// Left over after the deadline for logging and scheduling the continuation.
const RUN_SAFETY_MS = 40 * 1000;
// Data fetching stops this long before the deadline, keeping room for Gemini
// and Telegram delivery in the same execution.
const BRIEFING_RESERVE_MS = 150 * 1000;
const MAX_CONTINUATIONS = 3;
const CONTINUATION_KEY = 'BRIEFING_CONTINUATION';

function runDailyPortfolioIntelligence() {
  // Any top-level function can be called through the web app, so the one that
  // spends Gemini tokens refuses to run twice within a few minutes.
  if (!Utils.cooldown('DAILY_RUN', 300)) {
    Logger.log('Skipped: a briefing ran less than 5 minutes ago.');
    return;
  }
  // A fresh run supersedes any continuation still waiting from an earlier one.
  Scheduler.deleteTriggers('continueDailyBriefing');
  Config.remove(CONTINUATION_KEY);
  runBriefing_(0);
}

/**
 * Trigger target scheduled by a briefing that ran out of time. Only runs when
 * that briefing left a marker, so calling it through the web app can't be
 * used to get around runDailyPortfolioIntelligence's cooldown.
 */
function continueDailyBriefing() {
  Scheduler.deleteTriggers('continueDailyBriefing');
  const attempt = Number(Config.get(CONTINUATION_KEY) || 0);
  Config.remove(CONTINUATION_KEY);
  if (!attempt) {
    Logger.log('Skipped: no briefing is waiting to continue.');
    return;
  }
  runBriefing_(attempt);
}

function runBriefing_(continuation) {
  const deadline = Date.now() + RUN_LIMIT_MS - RUN_SAFETY_MS;
  AppLogger.startRun();
  try {
    Config.validate();
    const holdings = Portfolio.getHoldings();

    if (!holdings.length) {
      throw new Error('Portfolio sheet has no holdings.');
    }

    Utils.setDeadline(deadline - BRIEFING_RESERVE_MS);
    const enrichedHoldings = MarketData.enrichAll(holdings);
    // The briefing has already priced everything, so saving the snapshot here
    // is free, and the Mini App opens on the same numbers the message shows.
    const snapshot = Snapshot.save(Snapshot.build(enrichedHoldings));
    const companyNews = News.getNewsForTickers(enrichedHoldings);
    const macroNews = News.getMacroNews();
    const alerts = Alerts.buildAlerts(enrichedHoldings, companyNews);

    const reportInput = buildReportInput_(
      enrichedHoldings, companyNews, macroNews, alerts, snapshot
    );
    Utils.setDeadline(deadline);
    const report = reconcileWithMarketData_(Gemini.generateDailyBriefing(reportInput), enrichedHoldings);
    // From here on nothing may stop halfway: a continuation would send the
    // Telegram messages a second time.
    Utils.setDeadline(null);
    // Saved before sending, so the Mini App's Briefing tab has it even if
    // Telegram delivery fails.
    Utils.safeCall('Briefing save', null, () => Briefing.save(report, { holdings: enrichedHoldings, companyNews }));

    Telegram.sendDailyBriefing(report, { snapshot, alerts });
    // Keeps the chat's Mini App menu button on a link that hasn't expired.
    Utils.safeCall('Menu button refresh', null, () => Bot.installMenuButton());

    AppLogger.success('Daily briefing sent to Telegram', {
      holdings: enrichedHoldings.length,
      totalValue: Utils.round(snapshot.totals.value, 2),
      baseCurrency: snapshot.baseCurrency,
      continuations: continuation
    });
  } catch (error) {
    Utils.setDeadline(null);
    if (Utils.isOutOfTime(error) && continuation < MAX_CONTINUATIONS) {
      Config.set(CONTINUATION_KEY, String(continuation + 1));
      Scheduler.scheduleOnce('continueDailyBriefing', 60 * 1000);
      AppLogger.info('Daily briefing continues in a new execution', { continuation: continuation + 1 });
      return;
    }
    AppLogger.error('Daily briefing failed', error);
    Telegram.notifyFailure(error);
    throw error;
  }
}

/** Trigger target for the /briefing command: a one-off that cleans up after itself. */
function runOnDemandBriefing() {
  Scheduler.deleteTriggers('runOnDemandBriefing');
  runDailyPortfolioIntelligence();
}

/** Hourly trigger target: re-prices holdings so the Mini App stays current. */
function refreshPortfolioSnapshot() {
  AppLogger.startRun();
  try {
    Snapshot.refresh(Config.all().snapshotMinRefreshSeconds);
  } catch (error) {
    AppLogger.error('Snapshot refresh failed', error);
    throw error;
  }
}

function installPortfolioIntelligenceBot() {
  Config.validate();
  Portfolio.seedExampleData();
  Portfolio.ensureOptionalColumns();
  Scheduler.installWeekdayTrigger();
  Scheduler.installSnapshotTrigger();
  if (MiniApp.isConfigured()) {
    Bot.installWebhook();
    AppLogger.info('Installation complete', 'Briefing, hourly snapshot, bot commands and Mini App are ready.');
  } else {
    AppLogger.info('Installation complete', 'Briefing and hourly snapshot are ready. Deploy the web app, set WEBAPP_URL, then run installTelegramBot for commands and the Mini App.');
  }
}

/**
 * Run after deploying the web app and saving its /exec URL as WEBAPP_URL.
 * Registers the webhook, the command menu and the Mini App menu button.
 */
function installTelegramBot() {
  Config.validate();
  Bot.installWebhook();
  Logger.log(JSON.stringify(Bot.webhookInfo(), null, 2));
}

/** Prints a fresh Mini App link, handy for opening it in a desktop browser. */
function logMiniAppLink() {
  Logger.log(MiniApp.link());
}

function seedExampleSpreadsheet() {
  Portfolio.seedExampleData();
}

/**
 * Prints what the script actually resolves at runtime, and where each value
 * came from. Most settings can be overridden by a Script Property, so editing
 * a default in Config.gs has no effect while a property of the same name is
 * set - this makes that visible instead of leaving you diffing code against
 * behaviour. Run it from the editor and read the Execution log.
 */
function logResolvedConfig() {
  const cfg = Config.all();
  const overridable = [
    'GEMINI_MODEL', 'MARKET_DATA_PROVIDER', 'REPORT_TIMEZONE', 'SPREADSHEET_ID',
    'BASE_CURRENCY', 'WEBAPP_URL', 'MINI_APP_LINK_DAYS'
  ];

  Logger.log('--- Resolved configuration ---');
  Logger.log(`Gemini model in use : ${cfg.geminiModel}`);
  Logger.log(`Market data provider: ${cfg.marketDataProvider}`);
  Logger.log(`Base currency       : ${cfg.baseCurrency}`);

  Logger.log('--- Script Property overrides ---');
  overridable.forEach((key) => {
    const value = Config.get(key);
    Logger.log(`${key}: ${value === undefined ? '(not set - using Config.gs default)' : value}`);
  });

  // Presence only. Never log the values themselves: these lines go to the Logs
  // sheet and Stackdriver, and Finnhub's key in particular travels as a plain
  // query parameter, so anything that prints it leaks a live credential.
  Logger.log('--- Secrets present? ---');
  ['GEMINI_API_KEY', 'FINNHUB_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DASHBOARD_API_KEY'].forEach((key) => {
    Logger.log(`${key}: ${Config.get(key) ? 'set' : 'MISSING'}`);
  });
}

// Helpers below end in "_" so the web app can't invoke them via google.script.run.

function buildReportInput_(enrichedHoldings, companyNews, macroNews, alerts, snapshot) {
  const holdings = enrichedHoldings.map((holding) => ({
    ticker: holding.ticker,
    companyName: holding.companyName,
    market: holding.market,
    assetClass: holding.assetClass,
    currency: holding.currency,
    shares: holding.shares,
    sector: holding.sector,
    price: holding.price,
    dailyChangePercent: holding.dailyChangePercent,
    marketCap: holding.marketCap,
    peRatio: holding.peRatio,
    week52High: holding.week52High,
    week52Low: holding.week52Low,
    volume: holding.volume,
    averageVolume: holding.averageVolume,
    earningsDate: holding.earningsDate,
    positionValue: holding.positionValue,
    positionValueBase: holding.positionValueBase,
    unrealizedGainPercent: holding.unrealizedGainPercent,
    news: summarizeArticles_(companyNews[holding.ticker] || []),
    alerts: alerts[holding.ticker] || []
  }));

  return {
    generatedAt: new Date().toISOString(),
    holdings,
    portfolioStats: calculatePortfolioStats_(enrichedHoldings, snapshot),
    macroNews: summarizeArticles_(macroNews),
    requiredSections: [
      'Portfolio Summary',
      'Market News',
      'Company Updates',
      'Macro Overview',
      "Today's Risks",
      "Today's Opportunities",
      'Upcoming Earnings'
    ]
  };
}

function summarizeArticles_(articles) {
  return (articles || []).map((article) => ({
    headline: article.headline || article.title || '',
    summary: Utils.truncate(article.summary || '', 700),
    source: article.source || '',
    url: article.url || '',
    datetime: article.datetime || ''
  }));
}

// Totals come from the snapshot, which has every position converted into the
// base currency. (Summing positionValue directly would add SGD to USD to HKD.)
function calculatePortfolioStats_(holdings, snapshot) {
  const summarizeGroups = (groups) => groups.reduce((result, g) => {
    result[g.name] = {
      value: Utils.round(g.value, 2),
      weight: Utils.round(g.weight, 4),
      dailyChangePercent: Utils.round(g.dayChangePercent, 2)
    };
    return result;
  }, {});

  const bySector = holdings.reduce((sectors, holding) => {
    const sector = holding.sector || 'Unknown';
    const value = Number(holding.positionValueBase || 0);
    if (!sectors[sector]) sectors[sector] = { value: 0, dailyWeightedChange: 0 };
    sectors[sector].value += value;
    sectors[sector].dailyWeightedChange += value * Number(holding.dailyChangePercent || 0);
    return sectors;
  }, {});
  Object.keys(bySector).forEach((sector) => {
    const item = bySector[sector];
    item.weight = snapshot.totals.value ? item.value / snapshot.totals.value : 0;
    item.dailyChangePercent = item.value ? item.dailyWeightedChange / item.value : 0;
    delete item.dailyWeightedChange;
  });

  const movers = holdings.filter((h) => h.assetClass !== 'Cash' && h.price);
  const sortedByMove = movers.slice().sort((a, b) => Number(b.dailyChangePercent || 0) - Number(a.dailyChangePercent || 0));
  return {
    baseCurrency: snapshot.baseCurrency,
    totalValue: snapshot.totals.value,
    dayChange: snapshot.totals.dayChange,
    dayChangePercent: snapshot.totals.dayChangePercent,
    unrealizedGainPercent: snapshot.totals.unrealizedGainPercent,
    byMarket: summarizeGroups(snapshot.byMarket),
    byAssetClass: summarizeGroups(snapshot.byAssetClass),
    sectorPerformance: bySector,
    biggestWinners: sortedByMove.slice(0, 3).map((holding) => `${holding.ticker} ${Utils.percent(holding.dailyChangePercent)}`),
    biggestLosers: sortedByMove.slice(-3).reverse().map((holding) => `${holding.ticker} ${Utils.percent(holding.dailyChangePercent)}`)
  };
}

/**
 * The model writes the narrative; the numbers come from market data. This
 * overwrites each company update's price change and bull/bear flag with the
 * real figures, and drops updates for tickers that aren't actually held.
 */
function reconcileWithMarketData_(report, enrichedHoldings) {
  const byTicker = {};
  enrichedHoldings.forEach((h) => { byTicker[h.ticker] = h; });
  report.companyUpdates = (report.companyUpdates || [])
    .filter((update) => byTicker[Utils.normalizeTicker(update.ticker)])
    .map((update) => {
      const holding = byTicker[Utils.normalizeTicker(update.ticker)];
      const change = Number(holding.dailyChangePercent || 0);
      return Object.assign({}, update, {
        ticker: holding.ticker,
        priceChange: Utils.percent(change),
        isBull: change >= 0
      });
    });
  return report;
}
