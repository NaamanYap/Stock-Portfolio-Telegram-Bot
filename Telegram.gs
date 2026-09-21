const Telegram = (() => {
  const FORMAT = Object.freeze({
    maxMessageLength: 3900,
    maxTopBulls: 5,
    maxTopBears: 5,
    maxAlerts: 10,
    separator: '───────────────────────',
    headerSeparator: '═══════════════════════════════',
    bullBearSeparator: '───────────────────',
    bullet: '🔹'
  });

  const HEADINGS = Object.freeze({
    title: '📈 Portfolio Update',
    portfolio: '💼 Portfolio',
    alerts: '🚨 Alerts',
    topBullsBears: '📰 My Holdings: Top 5 Bulls & Top 5 Bears',
    macroSnapshot: '🌍 Macro Snapshot',
    risks: "⚠️ Today's Risks",
    opportunities: "💡 Today's Opportunities",
    watchList: '👀 Watchlist'
  });

  /**
   * context (optional): { snapshot, alerts } - rendered deterministically
   * above the AI sections, so the portfolio numbers never depend on the model.
   */
  function sendDailyBriefing(report, context) {
    const dateLabel = report.date || Utilities.formatDate(new Date(), Config.all().reportTimezone || 'UTC', 'dd MMMM yyyy');
    const message = renderText(report, dateLabel, context || {});
    const parts = splitMessage(message);
    const button = Utils.safeCall('Mini App button', null, () => miniAppKeyboard());
    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      sendMessage(part, isLast && button ? { reply_markup: button } : {});
    });
  }

  /**
   * Calls a Bot API method with a JSON body. Retries once on 429 using the
   * retry_after Telegram supplies, since a multi-part briefing can trip the
   * per-chat flood limit.
   */
  function call(method, payload) {
    const token = Config.requireValue('TELEGRAM_BOT_TOKEN');
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      AppLogger.incrementApi('Telegram');
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        muteHttpExceptions: true,
        contentType: 'application/json',
        payload: JSON.stringify(payload || {})
      });
      const status = response.getResponseCode();
      const body = response.getContentText();
      if (status >= 200 && status < 300) {
        return JSON.parse(body).result;
      }
      if (status === 429 && attempt < 2) {
        const retryAfter = Utils.safeCall('Telegram retry_after', 1, () => JSON.parse(body).parameters.retry_after) || 1;
        Utilities.sleep(Math.min(Number(retryAfter), 30) * 1000);
        continue;
      }
      throw new Error(`Telegram ${method} HTTP ${status}: ${body.slice(0, 1000)}`);
    }
    return null;
  }

  function sendMessage(text, options, chatId) {
    return call('sendMessage', Object.assign({
      chat_id: chatId || Config.requireValue('TELEGRAM_CHAT_ID'),
      text,
      disable_web_page_preview: true
    }, options || {}));
  }

  /**
   * Inline button that opens the Mini App. Telegram only allows web_app
   * buttons in private chats, so group/channel chat IDs (negative numbers)
   * get a plain link button that opens in the browser instead.
   */
  function miniAppKeyboard(label) {
    if (!MiniApp.isConfigured()) return null;
    const text = label || '📊 Open portfolio';
    const url = MiniApp.link();
    const chatId = String(Config.requireValue('TELEGRAM_CHAT_ID'));
    const button = isPrivateChat(chatId) ? { text, web_app: { url } } : { text, url };
    return { inline_keyboard: [[button]] };
  }

  function isPrivateChat(chatId) {
    return !/^-/.test(String(chatId));
  }

  /** Best-effort: tells the chat a scheduled run failed instead of staying silent. */
  function notifyFailure(error) {
    try {
      const message = error && error.message ? error.message : String(error);
      sendMessage(`⚠️ Portfolio briefing failed\n\n${Utils.truncate(message, 600)}\n\nDetails are in the Logs sheet.`);
    } catch (ignored) {
      // Telegram itself may be what failed; the Logs sheet already has it.
    }
  }

  function renderText(report, dateLabel, context) {
    const ctx = context || {};
    const sections = [
      renderHeader(dateLabel),
      renderPortfolioSummary(ctx.snapshot),
      renderAlerts(ctx.alerts),
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


  function renderPortfolioSummary(snapshot) {
    if (!snapshot || !snapshot.totals || !snapshot.totals.value) return '';
    const ccy = snapshot.baseCurrency;
    const t = snapshot.totals;
    const lines = [
      HEADINGS.portfolio,
      `Total value: ${Utils.money(t.value, ccy)}`,
      `Today: ${Utils.signedMoney(t.dayChange, ccy)} (${Utils.percent(t.dayChangePercent)})`
    ];
    if (t.unrealizedGain !== null && t.unrealizedGain !== undefined) {
      lines.push(`Unrealised P/L: ${Utils.signedMoney(t.unrealizedGain, ccy)} (${Utils.percent(t.unrealizedGainPercent)})`);
    }
    if (snapshot.byMarket && snapshot.byMarket.length > 1) {
      lines.push('');
      snapshot.byMarket.forEach((m) => {
        lines.push(`${FORMAT.bullet} ${m.name}: ${Utils.money(m.value, ccy)} · ${Utils.round(m.weight * 100, 1)}% · ${Utils.percent(m.dayChangePercent)} today`);
      });
    }
    if (t.unpriced) {
      lines.push('', `⚠️ ${t.unpriced} holding(s) could not be priced and are excluded.`);
    }
    return lines.join('\n');
  }

  function renderAlerts(alertsByTicker) {
    if (!alertsByTicker) return '';
    const important = ['Price move', 'Upcoming earnings', 'Unusual volume', 'Analyst upgrade', 'Analyst downgrade', 'Dividend announcement'];
    const lines = [];
    Object.keys(alertsByTicker).forEach((ticker) => {
      alertsByTicker[ticker]
        .filter((alert) => important.indexOf(alert.type) !== -1)
        .forEach((alert) => lines.push(`${FORMAT.bullet} ${alert.message}`));
    });
    if (!lines.length) return '';
    return [HEADINGS.alerts].concat(lines.slice(0, FORMAT.maxAlerts)).join('\n');
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

    Briefing.MACRO_CATEGORIES.forEach((category) => addCategory(category.title, m[category.key]));

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
    // Break any single line longer than the limit first, so no part can exceed it.
    const lines = [];
    message.split('\n').forEach((line) => {
      if (!line.length) {
        lines.push(line);
        return;
      }
      for (let i = 0; i < line.length; i += FORMAT.maxMessageLength) {
        lines.push(line.slice(i, i + FORMAT.maxMessageLength));
      }
    });
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
    sendMessage,
    call,
    miniAppKeyboard,
    isPrivateChat,
    notifyFailure,
    renderPortfolioSummary,
    renderText
  };
})();