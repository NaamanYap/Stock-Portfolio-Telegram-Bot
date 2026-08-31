/**
 * Shared utilities for sheet parsing, HTTP calls, caching, dates, and formatting.
 */
const Utils = (() => {
  function normalizeTicker(ticker) {
    return String(ticker || '').trim().toUpperCase();
  }

  function round(value, digits) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (Number.isNaN(number)) return null;
    const factor = Math.pow(10, digits || 2);
    return Math.round(number * factor) / factor;
  }

  function percent(value) {
    const number = Number(value);
    if (Number.isNaN(number)) return 'n/a';
    const prefix = number > 0 ? '+' : '';
    return `${prefix}${round(number, 2)}%`;
  }

  function money(value) {
    const number = Number(value);
    if (Number.isNaN(number)) return 'n/a';
    return `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  function dateKey(date) {
    return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
  }

  function daysBetween(a, b) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((end - start) / msPerDay);
  }

  function parseHeaderRows(values) {
    if (!values || values.length < 2) return [];
    const headers = values[0].map((header) => String(header).trim());
    return values.slice(1)
      .filter((row) => row.some((cell) => cell !== '' && cell !== null))
      .map((row) => headers.reduce((record, header, index) => {
        record[header] = row[index];
        return record;
      }, {}));
  }

  function getOrCreateSheet(spreadsheet, name, headers) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
    }
    if (headers && sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  // Statuses worth retrying: 429 (rate limit) and 5xx (transient server-side
  // failures). Anything else - notably 403 (premium-only endpoint on our
  // plan) and 404 (bad symbol) - is permanent and should fail on the first
  // attempt rather than burning retry attempts and sleep time on it.
  const RETRYABLE_HTTP_STATUSES = [429, 500, 502, 503, 504];

  function fetchJson(url, options) {
    const settings = Config.all();
    const requestOptions = Object.assign({
      method: 'get',
      muteHttpExceptions: true,
      contentType: 'application/json'
    }, options || {});
    const cacheKey = `http:${Utilities.base64EncodeWebSafe(url).slice(0, 220)}`;
    const cache = CacheService.getScriptCache();

    if (!requestOptions.skipCache && requestOptions.method.toLowerCase() === 'get') {
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    // IMPORTANT: requestOptions sets muteHttpExceptions: true, so
    // UrlFetchApp.fetch() never throws for HTTP error statuses like 429/403 -
    // it just returns a response object with that status code. That means
    // the status check has to happen *inside* the work function passed to
    // retry() (and throw for retryable statuses) for retry()'s catch/backoff
    // to ever actually run for rate-limit or transient-server errors.
    // Previously the status check ran after retry() returned, so a 429 or
    // 500 got exactly one attempt and zero retries regardless of
    // maxRetries/retryBaseMs - those settings were silently inert for any
    // HTTP-level failure.
    const response = retry(() => {
      const res = UrlFetchApp.fetch(url, requestOptions);
      const status = res.getResponseCode();
      if (RETRYABLE_HTTP_STATUSES.indexOf(status) !== -1) {
        throw new Error(`HTTP ${status} (retryable): ${res.getContentText().slice(0, 500)}`);
      }
      return res;
    }, settings.maxRetries);

    const status = response.getResponseCode();
    const body = response.getContentText();

    if (status < 200 || status >= 300) {
      // Permanent failure (e.g. 403 premium-only, 404 bad symbol) reaches
      // here on the first attempt, without having consumed retry attempts.
      throw new Error(`HTTP ${status}: ${body.slice(0, 500)}`);
    }

    const parsed = body ? JSON.parse(body) : {};
    if (!requestOptions.skipCache && requestOptions.method.toLowerCase() === 'get') {
      // Caching is an optimization, not a correctness requirement - a large
      // response (e.g. Finnhub's /stock/metric?metric=all, which returns
      // dozens of TTM/quarterly/annual fields and can exceed CacheService's
      // ~100KB per-value limit) must not cause us to discard data we already
      // successfully fetched and parsed. Without this try/catch, cache.put()
      // throwing "Argument too large: value" would propagate up through
      // getMetrics() and safeCall, silently replacing real metrics with the
      // {} fallback even though the Finnhub call itself succeeded.
      try {
        cache.put(cacheKey, JSON.stringify(parsed), settings.cacheTtlSeconds);
      } catch (cacheError) {
        Logger.log(`[fetchJson] Skipping cache write for ${redactUrl(url).slice(0, 120)}: ${cacheError}`);
      }
    }
    return parsed;
  }

  function retry(work, maxRetries) {
    const settings = Config.all();
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        return work();
      } catch (error) {
        lastError = error;
        const delay = settings.retryBaseMs * Math.pow(2, attempt);
        Utilities.sleep(delay);
      }
    }
    throw lastError;
  }

  function safeCall(label, fallback, work) {
    try {
      return work();
    } catch (error) {
      AppLogger.error(label, error);
      return fallback;
    }
  }

  // Finnhub takes its API key as a `token` query parameter, so any raw URL is a
  // credential. Log lines land in the Logs sheet and in Stackdriver, both of
  // which get shared around when something breaks - redact before writing.
  function redactUrl(url) {
    return String(url || '').replace(/([?&](?:token|key|api_?key)=)[^&]*/gi, '$1[REDACTED]');
  }

  function truncate(text, maxLength) {
    const value = String(text || '');
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
  }

  return {
    normalizeTicker,
    round,
    percent,
    money,
    dateKey,
    daysBetween,
    parseHeaderRows,
    getOrCreateSheet,
    fetchJson,
    retry,
    safeCall,
    redactUrl,
    truncate
  };
})();
