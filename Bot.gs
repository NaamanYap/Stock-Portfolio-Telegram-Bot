/**
 * Interactive commands, delivered by Telegram to this script's doPost via a
 * webhook.
 *
 * Two Apps Script quirks shape this file:
 * - doPost can't read request headers, so Telegram's secret-token header is
 *   unusable. The webhook URL carries a secret query parameter instead.
 * - Apps Script answers every POST with a 302 redirect, which Telegram may
 *   treat as a failed delivery and resend. Each update_id is therefore
 *   processed at most once (remembered in CacheService for 6 hours).
 */
const Bot = (() => {
  const WEBHOOK_SECRET_KEY = 'TELEGRAM_WEBHOOK_SECRET';

  const COMMANDS = Object.freeze([
    { command: 'portfolio', description: 'Total value across all markets' },
    { command: 'markets', description: 'Breakdown by market' },
    { command: 'top', description: "Today's biggest movers" },
    { command: 'app', description: 'Open the portfolio Mini App' },
    { command: 'refresh', description: 'Re-price holdings now' },
    { command: 'briefing', description: 'Generate the full AI briefing now' },
    { command: 'help', description: 'What this bot can do' }
  ]);

  // A /portfolio reply re-prices first if the stored snapshot is older than this.
  const STALE_SNAPSHOT_SECONDS = 30 * 60;

  function handleWebhook(e) {
    const ok = ContentService.createTextOutput('ok');
    try {
      const expected = Config.get(WEBHOOK_SECRET_KEY);
      if (!expected || !e || !e.parameter || e.parameter.hook !== expected) return ok;

      const update = JSON.parse((e.postData && e.postData.contents) || '{}');
      if (!update.update_id || alreadyHandled(update.update_id)) return ok;

      const message = update.message;
      if (!message || !message.text) return ok;

      // Only the configured chat may use the bot - it reads a private portfolio.
      if (String(message.chat.id) !== String(Config.requireValue('TELEGRAM_CHAT_ID'))) return ok;

      handleCommand(message);
    } catch (error) {
      AppLogger.error('Webhook update failed', error);
    }
    return ok;
  }

  function alreadyHandled(updateId) {
    const cache = CacheService.getScriptCache();
    const key = `tg_update_${updateId}`;
    if (cache.get(key)) return true;
    cache.put(key, '1', 21600);
    return false;
  }

  function handleCommand(message) {
    // "/portfolio@MyBot extra" -> "portfolio"
    const command = String(message.text).trim().split(/\s+/)[0].replace(/^\//, '').replace(/@.*$/, '').toLowerCase();
    const chatId = message.chat.id;

    switch (command) {
      case 'portfolio':
      case 'value':
        return reply(chatId, portfolioText(freshSnapshot()), true);
      case 'markets':
        return reply(chatId, marketsText(freshSnapshot()), true);
      case 'top':
        return reply(chatId, moversText(freshSnapshot()), false);
      case 'app':
        return reply(chatId, 'Your portfolio dashboard:', true);
      case 'refresh': {
        const snapshot = Snapshot.refresh(Config.all().snapshotMinRefreshSeconds);
        return reply(chatId, portfolioText(snapshot), true);
      }
      case 'briefing':
        scheduleOnDemandBriefing();
        return reply(chatId, '⏳ Generating your briefing - it usually arrives within a few minutes.', false);
      case 'start':
      case 'help':
      default:
        return reply(chatId, helpText(), true);
    }
  }

  function reply(chatId, text, withAppButton) {
    const keyboard = withAppButton ? Utils.safeCall('Mini App button', null, () => Telegram.miniAppKeyboard()) : null;
    return Telegram.sendMessage(text, keyboard ? { reply_markup: keyboard } : {}, chatId);
  }

  function freshSnapshot() {
    const snapshot = Snapshot.latest();
    if (snapshot && Snapshot.ageSeconds(snapshot) < STALE_SNAPSHOT_SECONDS
        && snapshot.baseCurrency === Config.all().baseCurrency) {
      return snapshot;
    }
    return Snapshot.refresh(0);
  }

  function portfolioText(snapshot) {
    if (!snapshot) return 'No portfolio data yet - check the Portfolio sheet has holdings.';
    return [Telegram.renderPortfolioSummary(snapshot), '', updatedLabel(snapshot)].join('\n');
  }

  function marketsText(snapshot) {
    if (!snapshot) return 'No portfolio data yet.';
    const ccy = snapshot.baseCurrency;
    const lines = ['🌐 By market', ''];
    snapshot.byMarket.forEach((market) => {
      lines.push(`${market.name} - ${Utils.money(market.value, ccy)} (${Utils.round(market.weight * 100, 1)}%)`);
      snapshot.holdings
        .filter((h) => h.market === market.name && h.valueBase)
        .slice(0, 6)
        .forEach((h) => lines.push(`   ${h.ticker}  ${Utils.money(h.valueBase, ccy)}  ${Utils.percent(h.dailyChangePercent)}`));
      lines.push('');
    });
    lines.push(updatedLabel(snapshot));
    return lines.join('\n');
  }

  function moversText(snapshot) {
    if (!snapshot) return 'No portfolio data yet.';
    const ccy = snapshot.baseCurrency;
    const movers = snapshot.holdings
      .filter((h) => h.valueBase && h.assetClass !== 'Cash')
      .sort((a, b) => Math.abs(b.dayChangeBase) - Math.abs(a.dayChangeBase))
      .slice(0, 8);
    if (!movers.length) return 'No movers yet today.';
    const lines = ["📊 Today's biggest movers (by value)", ''];
    movers.forEach((h) => {
      const icon = h.dailyChangePercent >= 0 ? '🟢' : '🔴';
      lines.push(`${icon} ${h.ticker}  ${Utils.percent(h.dailyChangePercent)}  ${Utils.signedMoney(h.dayChangeBase, ccy)}`);
    });
    lines.push('', updatedLabel(snapshot));
    return lines.join('\n');
  }

  function updatedLabel(snapshot) {
    const tz = Config.all().reportTimezone || 'UTC';
    return `Updated ${Utilities.formatDate(new Date(snapshot.generatedAt), tz, 'dd MMM HH:mm')}`;
  }

  function helpText() {
    return [
      '👋 Portfolio Intelligence',
      '',
      COMMANDS.map((c) => `/${c.command} - ${c.description}`).join('\n'),
      '',
      'The weekday briefing still arrives automatically.'
    ].join('\n');
  }

  // Runs the briefing in its own execution a moment from now. Doing it inside
  // doPost would hold the webhook open for minutes and invite Telegram retries.
  function scheduleOnDemandBriefing() {
    ScriptApp.newTrigger('runOnDemandBriefing').timeBased().after(1000).create();
  }

  /** Points Telegram at this web app, registers the command menu and the Mini App button. */
  function installWebhook() {
    const baseUrl = Config.requireValue('WEBAPP_URL');
    let secret = Config.get(WEBHOOK_SECRET_KEY);
    if (!secret) {
      secret = Utilities.getUuid().replace(/-/g, '');
      Config.set(WEBHOOK_SECRET_KEY, secret);
    }
    Telegram.call('setWebhook', {
      url: `${baseUrl}?hook=${secret}`,
      allowed_updates: ['message'],
      drop_pending_updates: true
    });
    Telegram.call('setMyCommands', { commands: COMMANDS });
    installMenuButton();
  }

  /**
   * Sets the chat's menu button (left of the text box) to open the Mini App.
   * Links expire, so the daily run calls this again to keep it fresh.
   */
  function installMenuButton() {
    if (!MiniApp.isConfigured()) return;
    const chatId = Config.requireValue('TELEGRAM_CHAT_ID');
    if (!Telegram.isPrivateChat(chatId)) return;
    Telegram.call('setChatMenuButton', {
      chat_id: Number(chatId),
      menu_button: { type: 'web_app', text: 'Portfolio', web_app: { url: MiniApp.link() } }
    });
  }

  function webhookInfo() {
    return Telegram.call('getWebhookInfo', {});
  }

  return {
    handleWebhook,
    installWebhook,
    installMenuButton,
    webhookInfo
  };
})();
