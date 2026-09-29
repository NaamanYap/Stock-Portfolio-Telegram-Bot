const MarketData = (() => {
  function getProvider() {
    const provider = Config.all().marketDataProvider;
    if (provider !== 'FINNHUB') {
      throw new Error(`Unsupported MARKET_DATA_PROVIDER: ${provider}`);
    }
    return FinnhubProvider;
  }

  /**
   * Fetches quote + profile + metrics for a ticker in one place, so a caller
   * needing more than one shares a single fetch per ticker per run rather than
   * independently re-requesting the same data. fetchJson() already caches by
   * URL, so this mainly avoids relying on cache timing to prevent duplicate
   * real Finnhub hits, and avoids double-counting calls in AppLogger.
   */
  function fetchTickerData(ticker) {
    const provider = getProvider();
    const quote = Utils.safeCall(`${ticker} quote`, {}, () => provider.getQuote(ticker));
    const profile = Utils.safeCall(`${ticker} profile`, {}, () => provider.getProfile(ticker));
    const metrics = Utils.safeCall(`${ticker} metrics`, {}, () => provider.getMetrics(ticker));
    return { quote, profile, metrics };
  }

  /**
   * Prices and values one holding.
   *
   * options.full (default true) also pulls profile, metrics and the earnings
   * date - what the briefing needs. The Mini App snapshot only needs a price,
   * so it passes full:false and costs one call per holding instead of four.
   */
  function enrichHolding(holding, options) {
    const full = !options || options.full !== false;
    const item = holding.assetClass ? holding : Object.assign({}, holding, Markets.classify(holding));
    const ticker = item.ticker;
    const baseCurrency = Config.all().baseCurrency;

    let quote = {};
    let profile = {};
    let metrics = {};
    let earnings = null;
    let priceSource = null;

    if (item.assetClass === 'Cash') {
      quote = { currentPrice: 1, dailyChangePercent: 0, currency: item.currency };
      priceSource = 'cash';
    } else if (item.manualPrice) {
      quote = { currentPrice: item.manualPrice, dailyChangePercent: 0, currency: item.currency };
      priceSource = 'manual';
    } else if (item.isUsListing) {
      if (full) {
        const data = fetchTickerData(ticker);
        quote = data.quote;
        profile = data.profile;
        metrics = data.metrics;
        earnings = Utils.safeCall(`${ticker} earnings`, null, () => getProvider().getNextEarningsDate(ticker));
      } else {
        quote = getQuote(ticker);
      }
      priceSource = 'finnhub';
      // Finnhub answers unknown symbols with zeros rather than an error; ETFs
      // and funds on some plans do the same. Yahoo is the fallback.
      if (!quote.currentPrice) {
        quote = Utils.safeCall(`${ticker} yahoo quote`, {}, () => YahooProvider.getQuote(item.pricingSymbol));
        priceSource = quote.currentPrice ? 'yahoo' : null;
      }
      quote.currency = quote.currency || 'USD';
    } else {
      quote = Utils.safeCall(`${ticker} yahoo quote`, {}, () => YahooProvider.getQuote(item.pricingSymbol));
      priceSource = quote.currentPrice ? 'yahoo' : null;
    }

    // Trust the currency the feed reports over the one inferred from the
    // ticker: it's the unit the price is actually in.
    const currency = quote.currency || item.currency;
    const price = quote.currentPrice || null;
    const dailyChangePercent = Number(quote.dailyChangePercent || 0);
    const positionValue = price && item.shares ? price * item.shares : null;
    const costBasis = item.shares && item.averageCost ? item.shares * item.averageCost : null;
    const unrealizedGain = positionValue !== null && costBasis ? positionValue - costBasis : null;
    const unrealizedGainPercent = unrealizedGain !== null && costBasis ? (unrealizedGain / costBasis) * 100 : null;

    const fxRate = FX.rate(currency, baseCurrency);
    const positionValueBase = positionValue !== null && fxRate !== null ? positionValue * fxRate : null;
    const costBasisBase = costBasis !== null && fxRate !== null ? costBasis * fxRate : null;
    // Today's move in base currency, from the local-currency % change. (FX
    // moves over the day are ignored - this is the asset's move, not the
    // currency's.)
    const dayChangeBase = positionValueBase !== null && dailyChangePercent
      ? positionValueBase - positionValueBase / (1 + dailyChangePercent / 100)
      : 0;

    return Object.assign({}, item, {
      companyName: item.companyName || profile.companyName || ticker,
      currency,
      price,
      priceSource,
      dailyChangePercent,
      volume: quote.volume || metrics.volume,
      marketCap: profile.marketCap || metrics.marketCap,
      peRatio: metrics.peRatio,
      week52High: metrics.week52High,
      week52Low: metrics.week52Low,
      averageVolume: metrics.averageVolume,
      earningsDate: earnings,
      positionValue,
      costBasis,
      unrealizedGain,
      unrealizedGainPercent,
      fxRate,
      positionValueBase,
      costBasisBase,
      dayChangeBase,
      _marketData: { quote, profile, metrics }
    });
  }

  function enrichAll(holdings, options) {
    return holdings.map((holding) => enrichHolding(holding, options));
  }

  function getQuote(ticker) {
    const provider = getProvider();
    return Utils.safeCall(`${ticker} quote`, {}, () => provider.getQuote(ticker));
  }

  function getProfile(ticker) {
    const provider = getProvider();
    return Utils.safeCall(`${ticker} profile`, {}, () => provider.getProfile(ticker));
  }

  function getMetrics(ticker) {
    const provider = getProvider();
    return Utils.safeCall(`${ticker} metrics`, {}, () => provider.getMetrics(ticker));
  }

  return {
    enrichAll,
    enrichHolding,
    fetchTickerData,
    getQuote,
    getProfile,
    getMetrics
  };
})();

const FinnhubProvider = (() => {
  const BASE_URL = 'https://finnhub.io/api/v1';

  function apiKey() {
    return Config.requireValue('FINNHUB_API_KEY');
  }

  // Proactive pacing to stay under Finnhub's free-tier 60-calls/minute cap.
  // Apps Script fires requests far faster than 1/second, so without this a run
  // with many holdings and watchlist tickers can burst past the limit within a
  // few seconds - after which every subsequent call gets 429'd for the rest of
  // that minute window, and fetchJson's retry/backoff (bounded by maxRetries *
  // retryBaseMs, only a few seconds total) isn't long enough to outlast a full
  // minute of exhausted quota. Spacing calls out here prevents tripping the
  // limit in the first place rather than reacting after the fact.
  // lastRequestTime is module-scoped (closure state), so it resets each
  // execution and only paces calls within a single run.
  let lastRequestTime = 0;

  function throttle() {
    const minIntervalMs = Config.all().finnhubMinIntervalMs;
    const elapsed = Date.now() - lastRequestTime;
    if (lastRequestTime && elapsed < minIntervalMs) {
      Utilities.sleep(minIntervalMs - elapsed);
    }
    lastRequestTime = Date.now();
  }

  // Note: this paces every call including ones served from fetchJson's cache
  // (the cache check happens inside fetchJson, after this point). A deliberate
  // simplicity trade-off - the delay on a cache hit is negligible next to the
  // cost of a rate-limit outage.

  function get(path, params) {
    const query = Object.keys(params || {})
      .concat('token')
      .map((key) => {
        const value = key === 'token' ? apiKey() : params[key];
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join('&');
    throttle();
    AppLogger.incrementApi('Finnhub');
    return Utils.fetchJson(`${BASE_URL}${path}?${query}`);
  }

  function getQuote(ticker) {
    const data = get('/quote', { symbol: ticker });
    return {
      currentPrice: data.c || null,
      dailyChangePercent: data.dp || 0,
      open: data.o || null,
      high: data.h || null,
      low: data.l || null,
      previousClose: data.pc || null,
      volume: data.v || null
    };
  }

  function getProfile(ticker) {
    const data = get('/stock/profile2', { symbol: ticker });
    return {
      companyName: data.name || '',
      marketCap: data.marketCapitalization ? data.marketCapitalization * 1000000 : null,
      sharesOutstanding: data.shareOutstanding ? data.shareOutstanding * 1000000 : null,
      sector: data.finnhubIndustry || '',
      country: data.country || '',
      currency: data.currency || ''
    };
  }

  function getMetrics(ticker) {
    const data = get('/stock/metric', { symbol: ticker, metric: 'all' });
    const metric = data.metric || {};

    return {
      marketCap: metric.marketCapitalization ? metric.marketCapitalization * 1000000 : null,
      peRatio: metric.peNormalizedAnnual || metric.peTTM || null,
      week52High: metric['52WeekHigh'] || null,
      week52Low: metric['52WeekLow'] || null,
      averageVolume: metric['10DayAverageTradingVolume'] || metric['3MonthAverageTradingVolume'] || null,
      volume: metric.volume || null,
      // Raw passthrough so you can inspect the full untouched Finnhub payload
      // from Logger output if a field ever looks off.
      _rawMetric: metric
    };
  }

  function getNextEarningsDate(ticker) {
    const today = new Date();
    const to = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000);
    const data = get('/calendar/earnings', {
      symbol: ticker,
      from: Utils.dateKey(today),
      to: Utils.dateKey(to)
    });
    const earningsCalendar = data.earningsCalendar || [];
    if (!earningsCalendar.length) return null;
    return earningsCalendar
      .map((item) => item.date)
      .filter(Boolean)
      .sort()[0] || null;
  }

  return {
    request: get,
    getQuote,
    getProfile,
    getMetrics,
    getNextEarningsDate
  };
})();
