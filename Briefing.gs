/**
 * The latest AI briefing, kept so the Mini App can show it.
 *
 * The daily run sends the briefing to Telegram as text; this stores the same
 * report (watchlist, macro, risks, opportunities) plus the watchlist headlines
 * it was written from. It only changes when a briefing runs (weekday mornings
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
   * context: { watchlist, watchlistNews } - the sheet's watchlist rows and the
   * ranked articles fetched for them.
   */
  function save(report, context) {
    const ctx = context || {};
    const watchlist = ctx.watchlist || [];
    const news = ctx.watchlistNews || {};

    const aiByTicker = {};
    (report.watchList || []).forEach((item) => {
      aiByTicker[Utils.normalizeTicker(item.ticker)] = item;
    });

    // Every watchlist row appears, in sheet order, even ones the model skipped
    // - their headlines are still worth seeing.
    const watchItems = watchlist.map((item) => {
      const ai = aiByTicker[item.ticker] || {};
      const outlook = parseOutlook(ai.outlook);
      return {
        ticker: item.ticker,
        companyName: item.companyName || '',
        market: item.market || '',
        catalyst: stripLabel(ai.catalyst, /^today'?s catalyst:\s*/i),
        outlook: outlook.text,
        sentiment: outlook.sentiment,
        // Mirrors News.getNewsForTickers: only US listings get company news.
        newsCovered: item.isUsListing !== false && item.assetClass !== 'Cash' && item.assetClass !== 'Crypto',
        headlines: (news[item.ticker] || []).slice(0, MAX_HEADLINES_PER_TICKER).map((article) => ({
          headline: article.headline || article.title || '',
          source: article.source || '',
          url: /^https?:\/\//i.test(article.url || '') ? article.url : '',
          datetime: article.datetime ? new Date(article.datetime * 1000).toISOString() : null
        }))
      };
    });

    const macro = report.macroOverview || {};
    return Utils.putChunked(PROPERTY_NAME, {
      version: 1,
      generatedAt: new Date().toISOString(),
      date: report.date || '',
      watchList: watchItems,
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

  // The prompt asks for outlooks that start with 🟢 / 🟡 / 🔴. Turn that into a
  // field the page can render with an icon and label, not just an emoji.
  function parseOutlook(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(🟢|🟡|🔴)\s*/u);
    const sentiment = !match ? null : match[1] === '🟢' ? 'bullish' : match[1] === '🔴' ? 'bearish' : 'neutral';
    return { sentiment, text: match ? text.slice(match[0].length) : text };
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
