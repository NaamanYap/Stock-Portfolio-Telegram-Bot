const Portfolio = (() => {
  const PORTFOLIO_HEADERS = ['Ticker', 'Company Name', 'Shares', 'Average Cost', 'Sector', 'Notes'];
  const WATCHLIST_HEADERS = ['Ticker', 'Company Name', 'Sector', 'Notes'];

  // Optional columns for holdings outside US equities. All can be left blank:
  // the market and currency are inferred from the ticker suffix (D05.SI ->
  // Singapore/SGD), and a blank Asset Class means Stock. For Cash rows, put
  // the amount in Shares and the currency in Currency (or use the currency
  // code as the ticker). Manual Price covers anything no feed can price
  // (private holdings, fixed deposits, unlisted funds).
  const OPTIONAL_PORTFOLIO_HEADERS = ['Asset Class', 'Market', 'Currency', 'Manual Price'];

  function getHoldings() {
    const sheet = Utils.getOrCreateSheet(
      Config.spreadsheet(),
      Config.all().sheets.portfolio,
      PORTFOLIO_HEADERS
    );
    const records = Utils.parseHeaderRows(sheet.getDataRange().getValues());
    return records
      .map((row) => ({
        ticker: Utils.normalizeTicker(row['Ticker']),
        companyName: String(row['Company Name'] || '').trim(),
        shares: Number(row['Shares'] || 0),
        averageCost: Number(row['Average Cost'] || 0),
        sector: String(row['Sector'] || '').trim(),
        notes: String(row['Notes'] || '').trim(),
        assetClass: String(row['Asset Class'] || '').trim(),
        market: String(row['Market'] || '').trim(),
        currency: String(row['Currency'] || '').trim().toUpperCase(),
        manualPrice: Number(row['Manual Price'] || 0) || null
      }))
      .filter((holding) => holding.ticker)
      .map((holding) => Object.assign(holding, Markets.classify(holding)));
  }

  function getWatchlist() {
    const sheet = Utils.getOrCreateSheet(
      Config.spreadsheet(),
      Config.all().sheets.watchlist,
      WATCHLIST_HEADERS
    );
    const records = Utils.parseHeaderRows(sheet.getDataRange().getValues());
    return records
      .map((row) => ({
        ticker: Utils.normalizeTicker(row['Ticker']),
        companyName: String(row['Company Name'] || '').trim(),
        sector: String(row['Sector'] || '').trim(),
        notes: String(row['Notes'] || '').trim()
      }))
      .filter((item) => item.ticker)
      .map((item) => Object.assign(item, Markets.classify(item)));
  }

  /**
   * Adds any missing optional columns to the right of an existing Portfolio
   * header row, so upgrading doesn't require editing the sheet by hand.
   * Existing columns and data are never moved.
   */
  function ensureOptionalColumns() {
    const sheet = Utils.getOrCreateSheet(
      Config.spreadsheet(),
      Config.all().sheets.portfolio,
      PORTFOLIO_HEADERS.concat(OPTIONAL_PORTFOLIO_HEADERS)
    );
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((h) => String(h).trim());
    const missing = OPTIONAL_PORTFOLIO_HEADERS.filter((header) => headers.indexOf(header) === -1);
    if (missing.length) {
      sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    }
  }

  function seedExampleData() {
    const ss = Config.spreadsheet();
    const allPortfolioHeaders = PORTFOLIO_HEADERS.concat(OPTIONAL_PORTFOLIO_HEADERS);
    const portfolioSheet = Utils.getOrCreateSheet(ss, Config.all().sheets.portfolio, allPortfolioHeaders);
    const watchlistSheet = Utils.getOrCreateSheet(ss, Config.all().sheets.watchlist, WATCHLIST_HEADERS);

    if (portfolioSheet.getLastRow() <= 1) {
      const rows = [
        ['AAPL', 'Apple Inc.', 15, 165.25, 'Information Technology', 'Core holding', '', '', '', ''],
        ['MSFT', 'Microsoft Corporation', 8, 310.4, 'Information Technology', 'AI/cloud exposure', '', '', '', ''],
        ['JPM', 'JPMorgan Chase & Co.', 12, 145.1, 'Financials', 'Rate sensitivity', '', '', '', ''],
        ['XOM', 'Exxon Mobil Corporation', 20, 102.5, 'Energy', 'Oil hedge', '', '', '', ''],
        ['D05.SI', 'DBS Group Holdings', 100, 33.5, 'Financials', 'Singapore bank', 'Stock', '', '', ''],
        ['0700.HK', 'Tencent Holdings', 50, 320, 'Communication Services', 'China internet', 'Stock', '', '', ''],
        ['BTC', 'Bitcoin', 0.05, 42000, 'Crypto', 'Long-term', 'Crypto', '', '', ''],
        ['SGD', 'SGD cash', 5000, '', 'Cash', 'Emergency fund', 'Cash', '', 'SGD', '']
      ];
      portfolioSheet.getRange(2, 1, rows.length, allPortfolioHeaders.length).setValues(rows);
    }

    if (watchlistSheet.getLastRow() <= 1) {
      watchlistSheet.getRange(2, 1, 3, WATCHLIST_HEADERS.length).setValues([
        ['NVDA', 'NVIDIA Corporation', 'Information Technology', 'AI infrastructure'],
        ['TSLA', 'Tesla, Inc.', 'Consumer Discretionary', 'High beta'],
        ['TLT', 'iShares 20+ Year Treasury Bond ETF', 'Fixed Income', 'Rates proxy']
      ]);
    }
  }

  return {
    getHoldings,
    getWatchlist,
    ensureOptionalColumns,
    seedExampleData
  };
})();
