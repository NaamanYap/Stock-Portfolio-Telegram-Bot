/**
 * Works out which market a holding trades in, what currency it is priced in,
 * and how to price it. Finnhub's free tier only quotes US listings, so
 * everything else (other exchanges, crypto) is priced from Yahoo Finance's
 * public chart endpoint, and cash is valued at face value.
 */
const Markets = (() => {
  const ASSET_CLASSES = Object.freeze(['Stock', 'ETF', 'Fund', 'Bond', 'Crypto', 'Cash', 'Other']);

  // Yahoo-style exchange suffix -> market label and trading currency. Plain
  // tickers (and US share classes like BRK.B, whose ".B" isn't listed here)
  // are treated as US listings.
  const EXCHANGE_SUFFIXES = Object.freeze({
    SI: { market: 'Singapore', currency: 'SGD' },
    HK: { market: 'Hong Kong', currency: 'HKD' },
    L: { market: 'United Kingdom', currency: 'GBP' },
    T: { market: 'Japan', currency: 'JPY' },
    TO: { market: 'Canada', currency: 'CAD' },
    V: { market: 'Canada', currency: 'CAD' },
    AX: { market: 'Australia', currency: 'AUD' },
    NZ: { market: 'New Zealand', currency: 'NZD' },
    DE: { market: 'Germany', currency: 'EUR' },
    F: { market: 'Germany', currency: 'EUR' },
    PA: { market: 'France', currency: 'EUR' },
    AS: { market: 'Netherlands', currency: 'EUR' },
    MI: { market: 'Italy', currency: 'EUR' },
    MC: { market: 'Spain', currency: 'EUR' },
    BR: { market: 'Belgium', currency: 'EUR' },
    HE: { market: 'Finland', currency: 'EUR' },
    SW: { market: 'Switzerland', currency: 'CHF' },
    ST: { market: 'Sweden', currency: 'SEK' },
    OL: { market: 'Norway', currency: 'NOK' },
    CO: { market: 'Denmark', currency: 'DKK' },
    TA: { market: 'Israel', currency: 'ILS' },
    KS: { market: 'South Korea', currency: 'KRW' },
    KQ: { market: 'South Korea', currency: 'KRW' },
    TW: { market: 'Taiwan', currency: 'TWD' },
    TWO: { market: 'Taiwan', currency: 'TWD' },
    SS: { market: 'China', currency: 'CNY' },
    SZ: { market: 'China', currency: 'CNY' },
    NS: { market: 'India', currency: 'INR' },
    BO: { market: 'India', currency: 'INR' },
    KL: { market: 'Malaysia', currency: 'MYR' },
    BK: { market: 'Thailand', currency: 'THB' },
    JK: { market: 'Indonesia', currency: 'IDR' },
    SA: { market: 'Brazil', currency: 'BRL' },
    MX: { market: 'Mexico', currency: 'MXN' },
    JO: { market: 'South Africa', currency: 'ZAR' }
  });

  // Some exchanges quote in the currency's minor unit (pence, agorot, cents).
  // Yahoo reports these codes; the price must be divided by 100 before it is
  // comparable with anything else.
  const MINOR_UNITS = Object.freeze({
    GBp: 'GBP',
    GBX: 'GBP',
    ILA: 'ILS',
    ZAc: 'ZAR',
    ZAC: 'ZAR'
  });

  const CRYPTO_PAIR = /^([A-Z0-9]{2,10})-(USD|USDT|USDC|EUR|GBP|SGD|JPY|AUD|CAD)$/;

  function normalizeAssetClass(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (/crypto|coin|token/.test(text)) return 'Crypto';
    if (/cash|deposit|money market|savings|fx/.test(text)) return 'Cash';
    if (/etf/.test(text)) return 'ETF';
    if (/bond|fixed income|treasury|t-bill/.test(text)) return 'Bond';
    if (/fund|unit trust|mutual/.test(text)) return 'Fund';
    if (/stock|equity|share|reit/.test(text)) return 'Stock';
    const exact = ASSET_CLASSES.filter((name) => name.toLowerCase() === text)[0];
    return exact || 'Other';
  }

  /**
   * Returns { assetClass, market, currency, pricingSymbol, isUsListing }.
   * Explicit sheet values (Asset Class / Market / Currency columns) always
   * win over what the ticker implies.
   */
  function classify(item) {
    const ticker = Utils.normalizeTicker(item.ticker);
    const explicitCurrency = String(item.currency || '').trim().toUpperCase();
    let assetClass = normalizeAssetClass(item.assetClass);

    if (!assetClass && CRYPTO_PAIR.test(ticker)) assetClass = 'Crypto';
    if (!assetClass) assetClass = 'Stock';

    if (assetClass === 'Cash') {
      const currency = explicitCurrency || (/^[A-Z]{3}$/.test(ticker) ? ticker : Config.all().baseCurrency);
      return {
        assetClass,
        market: item.market || 'Cash',
        currency,
        pricingSymbol: null,
        isUsListing: false
      };
    }

    if (assetClass === 'Crypto') {
      const pair = ticker.match(CRYPTO_PAIR);
      const quoteCurrency = pair ? pair[2].replace(/^USD[TC]$/, 'USD') : 'USD';
      return {
        assetClass,
        market: item.market || 'Crypto',
        currency: explicitCurrency || quoteCurrency,
        pricingSymbol: pair ? `${pair[1]}-${quoteCurrency}` : `${ticker}-USD`,
        isUsListing: false
      };
    }

    const suffixMatch = ticker.match(/\.([A-Z]{1,3})$/);
    const exchange = suffixMatch ? EXCHANGE_SUFFIXES[suffixMatch[1]] : null;
    if (exchange) {
      return {
        assetClass,
        market: item.market || exchange.market,
        currency: explicitCurrency || exchange.currency,
        pricingSymbol: ticker,
        isUsListing: false
      };
    }

    return {
      assetClass,
      market: item.market || 'US',
      currency: explicitCurrency || 'USD',
      // Yahoo writes share classes with a dash (BRK-B); Finnhub with a dot.
      pricingSymbol: ticker.replace(/\./g, '-'),
      isUsListing: true
    };
  }

  function minorUnitInfo(currency) {
    const major = MINOR_UNITS[currency];
    return major ? { currency: major, divisor: 100 } : { currency: String(currency || '').toUpperCase(), divisor: 1 };
  }

  return {
    ASSET_CLASSES,
    classify,
    normalizeAssetClass,
    minorUnitInfo
  };
})();

/**
 * Yahoo Finance's unofficial chart endpoint. No key, covers every exchange
 * and major crypto pairs, and reports the quote currency - which is what makes
 * multi-market totals possible without a paid data plan. Being unofficial, it
 * is only used where Finnhub's free tier can't help.
 */
const YahooProvider = (() => {
  const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

  function getQuote(symbol) {
    let lastError;
    for (let i = 0; i < HOSTS.length; i += 1) {
      try {
        return parseChart(fetchChart(HOSTS[i], symbol), symbol);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function fetchChart(host, symbol) {
    AppLogger.incrementApi('Yahoo');
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    return Utils.fetchJson(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioIntelligenceBot/1.0)' }
    });
  }

  function parseChart(data, symbol) {
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result || !result.meta) {
      const reason = data && data.chart && data.chart.error ? data.chart.error.description : 'no data';
      throw new Error(`Yahoo returned no quote for ${symbol}: ${reason}`);
    }
    const meta = result.meta;
    const unit = Markets.minorUnitInfo(meta.currency);
    const price = Number(meta.regularMarketPrice);
    if (!price) throw new Error(`Yahoo returned no price for ${symbol}`);

    // With range=5d, chartPreviousClose is the close *before* the window, so
    // take the second-to-last daily close as "yesterday" when we have it.
    const closes = (((result.indicators || {}).quote || [])[0] || {}).close || [];
    const validCloses = closes.filter((value) => value !== null && value !== undefined);
    const previousClose = validCloses.length >= 2
      ? Number(validCloses[validCloses.length - 2])
      : Number(meta.previousClose || meta.chartPreviousClose || 0);

    return {
      currentPrice: price / unit.divisor,
      previousClose: previousClose ? previousClose / unit.divisor : null,
      dailyChangePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
      currency: unit.currency,
      volume: Number(meta.regularMarketVolume || 0) || null,
      marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
    };
  }

  return {
    getQuote
  };
})();

/**
 * Currency conversion into the base currency. One request returns every rate,
 * and fetchJson caches it, so a whole run costs a single call.
 */
const FX = (() => {
  let ratesByBase = {};

  function rates(base) {
    if (!ratesByBase[base]) {
      AppLogger.incrementApi('FX');
      const data = Utils.fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
      if (data.result !== 'success' || !data.rates) {
        throw new Error(`FX rates unavailable for ${base}: ${data['error-type'] || 'unknown error'}`);
      }
      ratesByBase[base] = data.rates;
    }
    return ratesByBase[base];
  }

  /** Units of `to` per one unit of `from`, or null when unknown. */
  function rate(from, to) {
    const source = String(from || '').toUpperCase();
    const target = String(to || '').toUpperCase();
    if (!source || source === target) return 1;
    const table = Utils.safeCall(`FX ${target}`, null, () => rates(target));
    const perTarget = table && table[source];
    return perTarget ? 1 / perTarget : null;
  }

  function convert(amount, from, to) {
    if (amount === null || amount === undefined) return null;
    const fx = rate(from, to);
    return fx === null ? null : Number(amount) * fx;
  }

  return {
    rate,
    convert
  };
})();
