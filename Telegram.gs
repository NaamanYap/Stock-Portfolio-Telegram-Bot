const Telegram = (() => {
  const FORMAT = Object.freeze({
    maxMessageLength: 3900,
    maxTopBulls: 5,
    maxTopBears: 5,
    separator: '───────────────────────',
    headerSeparator: '═══════════════════════════════',
    bullBearSeparator: '───────────────────',
    bullet: '🔹'
  });

  const HEADINGS = Object.freeze({
    title: '📈 Portfolio Update',
    topBullsBears: '📰 My Holdings: Top 5 Bulls & Top 5 Bears',
    macroSnapshot: '🌍 Macro Snapshot',
    risks: "⚠️ Today's Risks",
    opportunities: "💡 Today's Opportunities",
    watchList: '👀 Watchlist'
  });

  function sendDailyBriefing(report) {
    const dateLabel = report.date || Utilities.formatDate(new Date(), Config.all().reportTimezone || 'UTC', 'dd MMMM yyyy');
    const message = renderText(report, dateLabel);
    splitMessage(message).forEach((part) => sendMessage(part));
  }

  function sendMessage(text) {
    const token = Config.requireValue('TELEGRAM_BOT_TOKEN');
    const chatId = Config.requireValue('TELEGRAM_CHAT_ID');
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;

    AppLogger.incrementApi('Telegram');
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      muteHttpExceptions: true,
      payload: {
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      }
    });

    const status = response.getResponseCode();
    const body = response.getContentText();
    if (status < 200 || status >= 300) {
      throw new Error(`Telegram HTTP ${status}: ${body.slice(0, 1000)}`);
    }
  }

  function renderText(report, dateLabel) {
    const sections = [
      renderHeader(dateLabel),
      renderTopBullsBears(report),
      renderWatchList(report),
      renderMacroSnapshot(report),
      renderRisks(report),
      renderOpportunities(report)
    ].filter(Boolean);

    // Join with standard separators, but handle the header separately
    let output = sections[0] + '\n\n' + sections.slice(1).join(`\n\n${FORMAT.separator}\n\n`);
    return output;
  }

  function renderHeader(date) {
    return `${HEADINGS.title} | Date: ${date}\n\n${FORMAT.headerSeparator}`;
  }


  function formatPercent(value) {
    const num = parseFloat(String(value || '').replace('%', ''));
    if (isNaN(num)) return value;
    return `${num.toFixed(2)}%`;
  }

  function renderTopBullsBears(report) {
    if (!report.companyUpdates || !report.companyUpdates.length) return '';
    
    const bulls = report.companyUpdates
      .filter((u) => u.isBull)
      .sort((a, b) => parseFloat(b.priceChange || 0) - parseFloat(a.priceChange || 0))
      .slice(0, FORMAT.maxTopBulls); 

    const bears = report.companyUpdates
      .filter((u) => !u.isBull)
      .sort((a, b) => parseFloat(a.priceChange || 0) - parseFloat(b.priceChange || 0))
      .slice(0, FORMAT.maxTopBears); 

    const bullSections = [];
    bulls.forEach((u, i) => {
      bullSections.push(
        `🟢 #${i + 1}: ${u.ticker} (${u.priceChange})\n` +
        `${u.whyMoved}\n` +
        `Wall Street Sentiment & Outlook: ${u.outlook}\n` +
        `${u.risks}`
      );
    });

    const bearSections = [];
    bears.forEach((u, i) => {
      bearSections.push(
        `🔴 #${i + 1}: ${u.ticker} (${u.priceChange})\n` +
        `${u.whyMoved}\n` +
        `Wall Street Sentiment & Outlook: ${u.outlook}\n` +
        `${u.risks}`
      );
    });

    let combined = [HEADINGS.topBullsBears];
    if (bullSections.length) combined.push(bullSections.join('\n\n'));
    if (bullSections.length && bearSections.length) combined.push(FORMAT.bullBearSeparator);
    if (bearSections.length) combined.push(bearSections.join('\n\n'));

    return combined.length > 1 ? combined.join('\n\n') : '';
  }

  function renderWatchList(report) {
    if (!report.watchList || !report.watchList.length) return '';
    
    const blocks = report.watchList.map((item) => {
      return (
        `${item.ticker} \n` +
        `${item.catalyst}\n` +
        `${item.outlook}`
      );
    });

    return blocks.length ? [HEADINGS.watchList].concat(blocks).join('\n\n') : '';
  }

  function renderMacroSnapshot(report) {
    if (!report.macroOverview) return '';
    const m = report.macroOverview;
    const sections = [];

    const addCategory = (title, arr) => {
      if (arr && arr.length) {
        sections.push(`${title}\n` + arr.map((x) => `${FORMAT.bullet} ${cleanBullet(x)}`).join('\n'));
      }
    };

    addCategory('Oil', m.oil);
    addCategory('Federal Reserve', m.fed);
    addCategory('USD / Gold', m.forexGold);
    addCategory('Technology', m.technology);
    addCategory('Geopolitics', m.geopolitics);
    addCategory('Markets', m.markets);

    return sections.length ? [HEADINGS.macroSnapshot].concat(sections).join('\n\n') : '';
  }

  function renderRisks(report) {
    if (!report.todaysRisks || !report.todaysRisks.length) return '';
    const risks = report.todaysRisks.map((r) => `${FORMAT.bullet} ${cleanBullet(r)}`);
    return [HEADINGS.risks].concat(risks).join('\n');
  }

  function renderOpportunities(report) {
    if (!report.todaysOpportunities || !report.todaysOpportunities.length) return '';
    const opps = report.todaysOpportunities.map((o) => `${FORMAT.bullet} ${cleanBullet(o)}`);
    return [HEADINGS.opportunities].concat(opps).join('\n');
  }

  function cleanBullet(value) {
    return String(value || '').replace(/^[-•*\s]+/, '').trim();
  }

  function splitMessage(message) {
    const lines = message.split('\n');
    const parts = [];
    let current = '';

    lines.forEach((line) => {
      const next = current ? `${current}\n${line}` : line;
      if (next.length > FORMAT.maxMessageLength) {
        if (current) parts.push(current);
        current = line;
      } else {
        current = next;
      }
    });

    if (current) parts.push(current);
    return parts;
  }

  return {
    sendDailyBriefing,
    renderText
  };
})();