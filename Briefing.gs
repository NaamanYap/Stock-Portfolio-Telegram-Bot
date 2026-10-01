/**
 * The latest AI briefing, kept so the Mini App can show it.
 *
 * The daily run sends the briefing to Telegram as text; this stores the same
 * report (per-holding updates, macro, risks, opportunities) plus the headlines
 * for each holding it was written from. It only changes when a briefing runs (weekday mornings
 * or /briefing) - the Mini App's refresh button re-prices holdings but doesn't
 * regenerate this, since that costs a Gemini call and a few minutes.
 */
const Briefing = (() => {
  const PROPERTY_NAME = 'BRIEFING';
  const MAX_HEADLINES_PER_TICKER = 3;

  // Shared with Telegram.renderMacroSnapshot so both show the same sections.
  const MACRO_CATEGORIES = Object.freeze([
    { key: 'oil', title: 'Oil' },
    { key: 'fed', title: 'Federal Reserve' },
    { key: 'forexGold', title: 'USD / Gold' },
    { key: 'technology', title: 'Technology' },
    { key: 'geopolitics', title: 'Geopolitics' },
    { key: 'markets', title: 'Markets' }
  ]);

  /**
   * context: { holdings, companyNews } - the priced holdings and the ranked
   * articles fetched for them. report.companyUpdates must already be
   * reconciled with market data (see reconcileWithMarketData_ in Main.gs).
   */
  function save(report, context) {
    const ctx = context || {};
    const holdings = ctx.holdings || [];
    const news = ctx.companyNews || {};

    const aiByTicker = {};
    (report.companyUpdates || []).forEach((item) => {
      aiByTicker[Utils.normalizeTicker(item.ticker)] = item;
    });

    // Every holding except cash appears, largest position first, even ones the
    // model skipped - their headlines are still worth seeing.
    const holdingItems = holdings
      .filter((h) => h.assetClass !== 'Cash')
      .sort((a, b) => Number(b.positionValueBase || 0) - Number(a.positionValueBase || 0))
      .map((h) => {
        const ai = aiByTicker[h.ticker] || {};
        return {
          ticker: h.ticker,
          companyName: h.companyName && h.companyName !== h.ticker ? h.companyName : '',
          market: h.market || '',
          dailyChangePercent: h.price ? Utils.round(h.dailyChangePercent, 2) : null,
          whyMoved: stripLabel(ai.whyMoved, /^today'?s critical news:\s*/i),
          outlook: stripLabel(ai.outlook, /^outlook:\s*/i),
          risks: stripLabel(ai.risks, /^key risks\s*&\s*alerts:\s*/i),
          // Mirrors News.getNewsForTickers: only US listings get company news.
          newsCovered: h.isUsListing !== false && h.assetClass !== 'Crypto',
          headlines: (news[h.ticker] || []).slice(0, MAX_HEADLINES_PER_TICKER).map((article) => ({
            headline: article.headline || article.title || '',
            source: article.source || '',
            url: /^https?:\/\//i.test(article.url || '') ? article.url : '',
            datetime: article.datetime ? new Date(article.datetime * 1000).toISOString() : null
          }))
        };
      });

    const macro = report.macroOverview || {};
    return Utils.putChunked(PROPERTY_NAME, {
      version: 2,
      generatedAt: new Date().toISOString(),
      date: report.date || '',
      holdings: holdingItems,
      macro: MACRO_CATEGORIES
        .map((category) => ({ title: category.title, items: cleanList(macro[category.key]) }))
        .filter((category) => category.items.length),
      risks: cleanList(report.todaysRisks),
      opportunities: cleanList(report.todaysOpportunities)
    });
  }

  function latest() {
    return Utils.getChunked(PROPERTY_NAME);
  }

  function stripLabel(value, pattern) {
    return String(value || '').trim().replace(pattern, '');
  }

  function cleanList(items) {
    return (items || [])
      .map((item) => String(item || '').replace(/^[-•*\s]+/, '').trim())
      .filter(Boolean);
  }

  return {
    MACRO_CATEGORIES,
    save,
    latest
  };
})();
