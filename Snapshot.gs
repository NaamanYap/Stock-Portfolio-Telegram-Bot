/**
 * A point-in-time valuation of the whole portfolio in the base currency.
 *
 * The Mini App reads the stored snapshot rather than pricing live, because
 * pricing is paced at ~1 call/second for Finnhub - a 20-holding portfolio
 * would take 20+ seconds to open. The daily briefing, an hourly trigger and
 * the Mini App's refresh button all write snapshots; the app just reads.
 *
 * Storage: the latest full snapshot lives in Script Properties (split into
 * chunks - one property holds at most 9KB), and one row per day of totals goes
 * to the "Portfolio History" sheet for the value-over-time chart.
 */
const Snapshot = (() => {
  // Stored as SNAPSHOT_CHUNKS + SNAPSHOT_CHUNK_<i> (see Utils.putChunked).
  const PROPERTY_NAME = 'SNAPSHOT';
  const HISTORY_HEADERS = [
    'Date',
    'Updated At',
    'Base Currency',
    'Total Value',
    'Cost Basis',
    'Day Change',
    'Holdings',
    'By Market'
  ];

  function build(valuedHoldings) {
    const baseCurrency = Config.all().baseCurrency;
    const priced = valuedHoldings.filter((h) => h.positionValueBase !== null && h.positionValueBase !== undefined);
    const unpriced = valuedHoldings.filter((h) => priced.indexOf(h) === -1);

    const totalValue = sum(priced, 'positionValueBase');
    const withCost = priced.filter((h) => h.costBasisBase);
    const costBasis = sum(withCost, 'costBasisBase');
    const valueWithCost = sum(withCost, 'positionValueBase');
    const dayChange = sum(priced, 'dayChangeBase');
    const previousValue = totalValue - dayChange;

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      baseCurrency,
      totals: {
        value: totalValue,
        costBasis,
        unrealizedGain: costBasis ? valueWithCost - costBasis : null,
        unrealizedGainPercent: costBasis ? ((valueWithCost - costBasis) / costBasis) * 100 : null,
        dayChange,
        dayChangePercent: previousValue ? (dayChange / previousValue) * 100 : 0,
        holdings: valuedHoldings.length,
        unpriced: unpriced.length
      },
      byMarket: group(priced, 'market', totalValue),
      byAssetClass: group(priced, 'assetClass', totalValue),
      byCurrency: group(priced, 'currency', totalValue),
      holdings: valuedHoldings
        .map((h) => ({
          ticker: h.ticker,
          name: h.companyName || h.ticker,
          market: h.market,
          assetClass: h.assetClass,
          sector: h.sector || '',
          currency: h.currency,
          shares: h.shares,
          price: h.price,
          averageCost: h.averageCost || null,
          dailyChangePercent: h.dailyChangePercent || 0,
          value: h.positionValue,
          valueBase: h.positionValueBase,
          dayChangeBase: h.dayChangeBase || 0,
          unrealizedGainPercent: h.unrealizedGainPercent,
          unrealizedGainBase: h.costBasisBase && h.positionValueBase !== null ? h.positionValueBase - h.costBasisBase : null,
          weight: totalValue && h.positionValueBase ? h.positionValueBase / totalValue : 0,
          priceSource: h.priceSource || null
        }))
        .sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0))
    };
  }

  function group(holdings, key, totalValue) {
    const groups = {};
    holdings.forEach((h) => {
      const name = h[key] || 'Other';
      if (!groups[name]) groups[name] = { name, value: 0, costBasis: 0, dayChange: 0, count: 0 };
      groups[name].value += h.positionValueBase;
      groups[name].costBasis += h.costBasisBase || 0;
      groups[name].dayChange += h.dayChangeBase || 0;
      groups[name].count += 1;
    });
    return Object.keys(groups)
      .map((name) => {
        const g = groups[name];
        const previous = g.value - g.dayChange;
        return Object.assign(g, {
          weight: totalValue ? g.value / totalValue : 0,
          dayChangePercent: previous ? (g.dayChange / previous) * 100 : 0
        });
      })
      .sort((a, b) => b.value - a.value);
  }

  function sum(items, key) {
    return items.reduce((total, item) => total + Number(item[key] || 0), 0);
  }

  function save(snapshot) {
    Utils.putChunked(PROPERTY_NAME, snapshot);
    Utils.safeCall('history write', null, () => appendHistory(snapshot));
    return snapshot;
  }

  function latest() {
    return Utils.getChunked(PROPERTY_NAME);
  }

  function ageSeconds(snapshot) {
    if (!snapshot || !snapshot.generatedAt) return Infinity;
    return (Date.now() - new Date(snapshot.generatedAt).getTime()) / 1000;
  }

  /**
   * Re-prices every holding (quotes only) and stores the result. Returns the
   * stored snapshot unchanged if one is younger than minAgeSeconds, and holds
   * a script lock so an hourly trigger and a Mini App tap can't price the
   * portfolio twice at once.
   */
  function refresh(minAgeSeconds) {
    const existing = latest();
    if (minAgeSeconds && ageSeconds(existing) < minAgeSeconds) return existing;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(60 * 1000)) {
      return existing;
    }
    try {
      // Someone else may have refreshed while we waited for the lock.
      const current = latest();
      if (minAgeSeconds && ageSeconds(current) < minAgeSeconds) return current;
      const holdings = Portfolio.getHoldings();
      return save(build(MarketData.enrichAll(holdings, { full: false })));
    } finally {
      lock.releaseLock();
    }
  }

  function historySheet() {
    return Utils.getOrCreateSheet(Config.spreadsheet(), Config.all().sheets.history, HISTORY_HEADERS);
  }

  // One row per calendar day (report timezone): later snapshots on the same
  // day overwrite that day's row, so the chart shows daily closes rather than
  // being dominated by hourly noise.
  function appendHistory(snapshot) {
    if (!snapshot.totals.value) return;
    const sheet = historySheet();
    const tz = Config.all().reportTimezone || 'UTC';
    const now = new Date(snapshot.generatedAt);
    const dateLabel = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const byMarket = {};
    snapshot.byMarket.forEach((m) => { byMarket[m.name] = Utils.round(m.value, 2); });
    const row = [
      dateLabel,
      now,
      snapshot.baseCurrency,
      Utils.round(snapshot.totals.value, 2),
      Utils.round(snapshot.totals.costBasis, 2),
      Utils.round(snapshot.totals.dayChange, 2),
      snapshot.totals.holdings,
      JSON.stringify(byMarket)
    ];

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const last = sheet.getRange(lastRow, 1, 1, 3).getValues()[0];
      if (dateKey(last[0], tz) === dateLabel && last[2] === snapshot.baseCurrency) {
        writeRow(sheet, lastRow, row);
        return;
      }
    }
    writeRow(sheet, lastRow + 1, row);
  }

  // The date is stored as plain text: left to itself, Sheets turns
  // "2026-09-19" into a locale-formatted date and the same-day check breaks.
  function writeRow(sheet, rowIndex, row) {
    sheet.getRange(rowIndex, 1).setNumberFormat('@');
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }

  function dateKey(value, tz) {
    return value instanceof Date ? Utilities.formatDate(value, tz, 'yyyy-MM-dd') : String(value || '');
  }

  /** [{ date, value, costBasis }] oldest first, for the current base currency only. */
  function history() {
    const sheet = historySheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const base = Config.all().baseCurrency;
    const tz = Config.all().reportTimezone || 'UTC';
    return sheet.getRange(2, 1, lastRow - 1, 5).getValues()
      .filter((row) => row[0] && row[2] === base)
      .map((row) => ({
        date: dateKey(row[0], tz),
        value: Number(row[3]) || 0,
        costBasis: Number(row[4]) || 0
      }))
      .filter((point) => point.value > 0);
  }

  return {
    build,
    save,
    latest,
    ageSeconds,
    refresh,
    history
  };
})();
