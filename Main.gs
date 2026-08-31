function runDailyPortfolioIntelligence() {
  AppLogger.startRun();
  try {
    Config.validate();
    const holdings = Portfolio.getHoldings();
    const watchlist = Portfolio.getWatchlist();

    if (!holdings.length) {
      throw new Error('Portfolio sheet has no holdings.');
    }

    const enrichedHoldings = MarketData.enrichAll(holdings);
    const companyNews = News.getNewsForTickers(enrichedHoldings);
    const watchlistNews = News.getNewsForTickers(watchlist);
    const macroNews = News.getMacroNews();
    const alerts = Alerts.buildAlerts(enrichedHoldings, companyNews);

    const reportInput = buildReportInput(
      enrichedHoldings, watchlist, companyNews, watchlistNews, macroNews, alerts
    );
    const report = Gemini.generateDailyBriefing(reportInput);

    Telegram.sendDailyBriefing(report, {
      alerts,
      enrichedHoldings,
      watchlist,
      macroNews
    });

    AppLogger.success('Daily briefing sent to Telegram', {
      holdings: enrichedHoldings.length,
      watchlist: watchlist.length
    });
  } catch (error) {
    AppLogger.error('Daily briefing failed', error);
    throw error;
  }
}

function installPortfolioIntelligenceBot() {
  Config.validate();
  Portfolio.seedExampleData();
  Scheduler.installWeekdayTrigger();
  AppLogger.info('Installation complete', 'Portfolio Intelligence Bot is ready.');
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
  const overridable = ['GEMINI_MODEL', 'MARKET_DATA_PROVIDER', 'REPORT_TIMEZONE', 'SPREADSHEET_ID'];

  Logger.log('--- Resolved configuration ---');
  Logger.log(`Gemini model in use : ${cfg.geminiModel}`);
  Logger.log(`Market data provider: ${cfg.marketDataProvider}`);

  Logger.log('--- Script Property overrides ---');
  overridable.forEach((key) => {
    const value = Config.get(key);
    Logger.log(`${key}: ${value === undefined ? '(not set - using Config.gs default)' : value}`);
  });

  // Presence only. Never log the values themselves: these lines go to the Logs
  // sheet and Stackdriver, and Finnhub's key in particular travels as a plain
  // query parameter, so anything that prints it leaks a live credential.
  Logger.log('--- Secrets present? ---');
  ['GEMINI_API_KEY', 'FINNHUB_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].forEach((key) => {
    Logger.log(`${key}: ${Config.get(key) ? 'set' : 'MISSING'}`);
  });
}

function buildReportInput(enrichedHoldings, watchlist, companyNews, watchlistNews, macroNews, alerts) {
  const holdings = enrichedHoldings.map((holding) => ({
    ticker: holding.ticker,
    companyName: holding.companyName,
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
    unrealizedGainPercent: holding.unrealizedGainPercent,
    news: summarizeArticles(companyNews[holding.ticker] || []),
    alerts: alerts[holding.ticker] || []
  }));

  return {
    generatedAt: new Date().toISOString(),
    holdings,
    portfolioStats: calculatePortfolioStats(enrichedHoldings),
    watchlist: watchlist.map((item) => ({
      ticker: item.ticker,
      companyName: item.companyName,
      sector: item.sector,
      notes: item.notes,
      news: summarizeArticles(watchlistNews[item.ticker] || [])
    })),
    macroNews: summarizeArticles(macroNews),
    requiredSections: [
      'Portfolio Summary',
      'Market News',
      'Company Updates',
      'Macro Overview',
      "Today's Risks",
      "Today's Opportunities",
      'Upcoming Earnings',
      'Watch List'
    ]
  };
}

function summarizeArticles(articles) {
  return (articles || []).map((article) => ({
    headline: article.headline || article.title || '',
    summary: Utils.truncate(article.summary || '', 700),
    source: article.source || '',
    url: article.url || '',
    datetime: article.datetime || ''
  }));
}

function calculatePortfolioStats(holdings) {
  const totalValue = holdings.reduce((sum, holding) => sum + Number(holding.positionValue || 0), 0);
  const bySector = holdings.reduce((sectors, holding) => {
    const sector = holding.sector || 'Unknown';
    if (!sectors[sector]) {
      sectors[sector] = { value: 0, dailyWeightedChange: 0 };
    }
    const value = Number(holding.positionValue || 0);
    sectors[sector].value += value;
    sectors[sector].dailyWeightedChange += value * Number(holding.dailyChangePercent || 0);
    return sectors;
  }, {});

  Object.keys(bySector).forEach((sector) => {
    const item = bySector[sector];
    item.weight = totalValue ? item.value / totalValue : 0;
    item.dailyChangePercent = item.value ? item.dailyWeightedChange / item.value : 0;
  });

  const sortedByMove = holdings.slice().sort((a, b) => Number(b.dailyChangePercent || 0) - Number(a.dailyChangePercent || 0));
  return {
    totalValue,
    sectorPerformance: bySector,
    biggestWinners: sortedByMove.slice(0, 3).map((holding) => `${holding.ticker} ${Utils.percent(holding.dailyChangePercent)}`),
    biggestLosers: sortedByMove.slice(-3).reverse().map((holding) => `${holding.ticker} ${Utils.percent(holding.dailyChangePercent)}`)
  };
}
