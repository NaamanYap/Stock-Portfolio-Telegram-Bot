/**
 * Portfolio and watchlist sheet readers.
 */
const Portfolio = (() => {
  const PORTFOLIO_HEADERS = ['Ticker', 'Company Name', 'Shares', 'Average Cost', 'Sector', 'Notes'];
  const WATCHLIST_HEADERS = ['Ticker', 'Company Name', 'Sector', 'Notes'];

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
        notes: String(row['Notes'] || '').trim()
      }))
      .filter((holding) => holding.ticker);
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
      .filter((item) => item.ticker);
  }

  function seedExampleData() {
    const ss = Config.spreadsheet();
    const portfolioSheet = Utils.getOrCreateSheet(ss, Config.all().sheets.portfolio, PORTFOLIO_HEADERS);
    const watchlistSheet = Utils.getOrCreateSheet(ss, Config.all().sheets.watchlist, WATCHLIST_HEADERS);

    if (portfolioSheet.getLastRow() <= 1) {
      portfolioSheet.getRange(2, 1, 4, PORTFOLIO_HEADERS.length).setValues([
        ['AAPL', 'Apple Inc.', 15, 165.25, 'Information Technology', 'Core holding'],
        ['MSFT', 'Microsoft Corporation', 8, 310.4, 'Information Technology', 'AI/cloud exposure'],
        ['JPM', 'JPMorgan Chase & Co.', 12, 145.1, 'Financials', 'Rate sensitivity'],
        ['XOM', 'Exxon Mobil Corporation', 20, 102.5, 'Energy', 'Oil hedge']
      ]);
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
    seedExampleData
  };
})();
