/**
 * Telegram Mini App: a portfolio dashboard served by this script's web app
 * deployment (HtmlService), opened from a button in the bot chat.
 *
 * Why signed links instead of Telegram's initData: HtmlService renders the
 * page inside a Google-hosted iframe, which can't read the URL fragment where
 * Telegram puts initData. So every link the bot hands out carries its own
 * short HMAC-signed token instead. Only the bot sends these links, only to
 * TELEGRAM_CHAT_ID, and they expire (MINI_APP_LINK_DAYS). Rotating the secret
 * with resetMiniAppLinks() revokes every link issued so far.
 */
const MiniApp = (() => {
  const SECRET_KEY = 'MINI_APP_SECRET';

  function secret() {
    let value = Config.get(SECRET_KEY);
    if (!value) {
      value = Utilities.getUuid() + Utilities.getUuid();
      Config.set(SECRET_KEY, value);
    }
    return value;
  }

  function sign(payload) {
    const bytes = Utilities.computeHmacSha256Signature(payload, secret());
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  }

  function issueToken(days) {
    const lifetimeDays = days || Config.all().miniAppLinkDays;
    const expiresAt = Math.floor(Date.now() / 1000) + Math.round(lifetimeDays * 86400);
    const payload = String(expiresAt);
    return `${payload}.${sign(payload)}`;
  }

  function isValidToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
    if (Number(parts[0]) < Date.now() / 1000) return false;
    return constantTimeEquals(sign(parts[0]), parts[1]);
  }

  function assertToken(token) {
    if (!isValidToken(token)) {
      throw new Error('This link has expired. Send /app to the bot for a fresh one.');
    }
  }

  function constantTimeEquals(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  /**
   * The /exec URL of the web app deployment. Set WEBAPP_URL explicitly:
   * ScriptApp.getService().getUrl() can return the /dev URL (which only the
   * owner can open) depending on how the script was invoked.
   */
  function baseUrl() {
    const url = Config.get('WEBAPP_URL') || (ScriptApp.getService().getUrl() || '');
    if (!url) {
      throw new Error('WEBAPP_URL is not set. Deploy the script as a web app and save its /exec URL as the WEBAPP_URL Script Property.');
    }
    return url;
  }

  function isConfigured() {
    return Boolean(Config.get('WEBAPP_URL'));
  }

  function link(days) {
    return `${baseUrl()}?t=${encodeURIComponent(issueToken(days))}`;
  }

  function render(e) {
    const token = (e && e.parameter && e.parameter.t) || '';
    let output;
    if (isValidToken(token)) {
      const template = HtmlService.createTemplateFromFile('MiniAppPage');
      template.token = token;
      output = template.evaluate();
    } else {
      output = HtmlService.createHtmlOutput(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="font-family:system-ui,sans-serif;padding:24px;text-align:center;color:#52514e">' +
        '<h3 style="color:#0b0b0b">Link expired</h3>' +
        '<p>Send <b>/app</b> to the bot for a fresh portfolio link.</p></body>'
      );
    }
    return output
      .setTitle('Portfolio')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
      // Telegram Desktop and web.telegram.org embed Mini Apps in an iframe.
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  function payload(snapshot) {
    return {
      snapshot,
      history: Utils.safeCall('history read', [], () => Snapshot.history()),
      briefing: Utils.safeCall('briefing read', null, () => Briefing.latest()),
      ageSeconds: Math.round(Snapshot.ageSeconds(snapshot)),
      timezone: Config.all().reportTimezone || 'UTC'
    };
  }

  function getData(token) {
    assertToken(token);
    let snapshot = Snapshot.latest();
    // First open ever, or the stored snapshot predates a base-currency change
    // or the sector grouping.
    if (!snapshot || snapshot.baseCurrency !== Config.all().baseCurrency || !snapshot.bySector) {
      snapshot = Snapshot.refresh(0);
    }
    return payload(snapshot);
  }

  function refreshData(token) {
    assertToken(token);
    return payload(Snapshot.refresh(Config.all().snapshotMinRefreshSeconds));
  }

  /**
   * JSON for the Stock Finder dashboard, which shows this portfolio in its own
   * Portfolio tab. Its server calls GET /exec?api=data|refresh&key=... with the
   * DASHBOARD_API_KEY Script Property; the key never reaches a browser. Without
   * that property set, the endpoint is off. ContentService can't set an HTTP
   * status, so failures come back as { error }.
   */
  function api(e) {
    const params = (e && e.parameter) || {};
    const expected = Config.get('DASHBOARD_API_KEY');
    let body;
    if (!expected || !constantTimeEquals(String(params.key || ''), expected)) {
      body = { error: 'Unauthorized: DASHBOARD_API_KEY is missing or does not match.' };
    } else {
      try {
        if (params.api === 'data') {
          body = getData(issueToken(1));
        } else if (params.api === 'refresh') {
          body = refreshData(issueToken(1));
        } else {
          body = { error: `Unknown api: ${params.api}` };
        }
      } catch (error) {
        body = { error: error.message || String(error) };
      }
    }
    return ContentService.createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return {
    issueToken,
    isValidToken,
    isConfigured,
    link,
    render,
    api,
    getData,
    refreshData
  };
})();

// ---- Web app entry points -------------------------------------------------
// google.script.run can call any top-level function whose name doesn't end in
// "_", so the page-facing ones below check the token themselves.

function doGet(e) {
  if (e && e.parameter && e.parameter.api) return MiniApp.api(e);
  return MiniApp.render(e);
}

function doPost(e) {
  return Bot.handleWebhook(e);
}

function getMiniAppData(token) {
  return MiniApp.getData(token);
}

function refreshMiniAppData(token) {
  return MiniApp.refreshData(token);
}

/** Invalidates every Mini App link issued so far, then re-issues the menu button. */
function resetMiniAppLinks() {
  Config.remove('MINI_APP_SECRET');
  Bot.installMenuButton();
  Logger.log('All previous Mini App links are now invalid. The chat menu button has a fresh link.');
}
