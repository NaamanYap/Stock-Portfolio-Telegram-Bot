const News = (() => {
  const ALERT_KEYWORDS = Object.freeze([
    'upgrade',
    'downgrade',
    'initiates',
    'raises price target',
    'cuts price target',
    'dividend',
    'sec filing',
    '8-k',
    '10-q',
    '10-k',
    '13f'
  ]);

  const MACRO_QUERIES = Object.freeze([
    'Federal Reserve interest rates inflation',
    'ECB rates inflation eurozone',
    'Bank of Japan yen rates',
    'oil prices OPEC geopolitics',
    'gold prices dollar',
    'US dollar macro markets geopolitics'
  ]);

  function getCompanyNews(ticker, companyName) {
    const articles = Utils.safeCall(`${ticker} news`, [], () => FinnhubNewsProvider.getCompanyNews(ticker));
    return rankAndFilter(articles, ticker, companyName).slice(0, Config.all().maxNewsPerTicker);
  }

  function getNewsForTickers(items) {
    return items.reduce((result, item) => {
      result[item.ticker] = getCompanyNews(item.ticker, item.companyName);
      return result;
    }, {});
  }

  function getMacroNews() {
    const allArticles = MACRO_QUERIES.flatMap((query) => (
      Utils.safeCall(`macro news ${query}`, [], () => FinnhubNewsProvider.getGeneralNews(query))
    ));
    return dedupeArticles(allArticles)
      .map((article) => Object.assign({}, article, {
        importanceScore: scoreArticle(article, '', '')
      }))
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, 12);
  }

  function rankAndFilter(articles, ticker, companyName) {
    return dedupeArticles(articles)
      .filter((article) => isRelevant(article, ticker, companyName))
      .map((article) => Object.assign({}, article, {
        importanceScore: scoreArticle(article, ticker, companyName)
      }))
      .sort((a, b) => b.importanceScore - a.importanceScore);
  }

  function dedupeArticles(articles) {
    const seen = {};
    return articles.filter((article) => {
      const title = normalize(article.headline || article.title);
      const key = article.url || title;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function isRelevant(article, ticker, companyName) {
    const text = normalize(`${article.headline || article.title} ${article.summary || ''}`);
    const companyTokens = normalize(companyName).split(' ').filter((token) => token.length > 3);
    if (text.indexOf(normalize(ticker)) >= 0) return true;
    return companyTokens.some((token) => text.indexOf(token) >= 0);
  }

  function scoreArticle(article, ticker, companyName) {
    const text = normalize(`${article.headline || article.title} ${article.summary || ''}`);
    let score = 0;
    const highImpact = [
      'earnings',
      'guidance',
      'revenue',
      'profit',
      'forecast',
      'lawsuit',
      'regulator',
      'merger',
      'acquisition',
      'dividend',
      'buyback',
      'layoff',
      'upgrade',
      'downgrade'
    ];
    highImpact.forEach((keyword) => {
      if (text.indexOf(keyword) >= 0) score += 3;
    });
    if (ticker && text.indexOf(normalize(ticker)) >= 0) score += 4;
    if (companyName && text.indexOf(normalize(companyName).split(' ')[0]) >= 0) score += 2;
    if (article.source) score += 1;
    if (article.datetime) {
      const hoursOld = (new Date().getTime() - new Date(article.datetime * 1000).getTime()) / 3600000;
      score += Math.max(0, 8 - hoursOld / 3);
    }
    return Utils.round(score, 2);
  }

  function extractNewsAlerts(articles) {
    return articles.filter((article) => {
      const text = normalize(`${article.headline || article.title} ${article.summary || ''}`);
      return ALERT_KEYWORDS.some((keyword) => text.indexOf(keyword) >= 0);
    }).map((article) => ({
      type: classifyNewsAlert(article),
      headline: article.headline || article.title,
      url: article.url
    }));
  }

  function classifyNewsAlert(article) {
    const text = normalize(`${article.headline || article.title} ${article.summary || ''}`);
    if (text.indexOf('downgrade') >= 0 || text.indexOf('cuts price target') >= 0) return 'Analyst downgrade';
    if (text.indexOf('upgrade') >= 0 || text.indexOf('raises price target') >= 0) return 'Analyst upgrade';
    if (text.indexOf('dividend') >= 0) return 'Dividend announcement';
    if (text.indexOf('sec filing') >= 0 || text.indexOf('8-k') >= 0 || text.indexOf('10-q') >= 0 || text.indexOf('10-k') >= 0) return 'SEC filing';
    return 'Market news alert';
  }

  function normalize(value) {
    return String(value || '').toLowerCase();
  }

  return {
    getCompanyNews,
    getNewsForTickers,
    getMacroNews,
    extractNewsAlerts
  };
})();

const FinnhubNewsProvider = (() => {
  const BASE_URL = 'https://finnhub.io/api/v1';

  function apiKey() {
    return Config.requireValue('FINNHUB_API_KEY');
  }

  function get(path, params) {
    const query = Object.keys(params || {})
      .concat('token')
      .map((key) => {
        const value = key === 'token' ? apiKey() : params[key];
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join('&');
    AppLogger.incrementApi('Finnhub');
    return Utils.fetchJson(`${BASE_URL}${path}?${query}`);
  }

  function getCompanyNews(ticker) {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return get('/company-news', {
      symbol: ticker,
      from: Utils.dateKey(yesterday),
      to: Utils.dateKey(today)
    });
  }

  function getGeneralNews(query) {
    const news = get('/news', { category: 'general' });
    const normalizedQuery = String(query || '').toLowerCase().split(' ').filter(Boolean);
    return news.filter((article) => {
      const text = `${article.headline || ''} ${article.summary || ''}`.toLowerCase();
      return normalizedQuery.some((word) => text.indexOf(word) >= 0);
    });
  }

  return {
    getCompanyNews,
    getGeneralNews
  };
})();
