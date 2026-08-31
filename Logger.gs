const AppLogger = (() => {
  const HEADERS = [
    'Timestamp',
    'Level',
    'Event',
    'Details',
    'Execution Ms',
    'API Usage',
    'Tokens Used',
    'Last Successful Run'
  ];

  let runContext = {
    startedAt: null,
    apiUsage: {},
    tokensUsed: 0
  };

  function startRun() {
    runContext = {
      startedAt: new Date(),
      apiUsage: {},
      tokensUsed: 0
    };
  }

  function incrementApi(provider, count) {
    runContext.apiUsage[provider] = (runContext.apiUsage[provider] || 0) + (count || 1);
  }

  function addTokens(count) {
    runContext.tokensUsed += Number(count || 0);
  }

  function info(event, details) {
    write('INFO', event, details);
  }

  function warn(event, details) {
    write('WARN', event, details);
  }

  function error(event, errorValue) {
    const details = errorValue && errorValue.stack ? errorValue.stack : String(errorValue || '');
    write('ERROR', event, details);
  }

  function success(event, details) {
    write('SUCCESS', event, details, new Date());
  }

  function write(level, event, details, successfulRunDate) {
    const sheet = getLogSheet();
    const elapsed = runContext.startedAt ? new Date().getTime() - runContext.startedAt.getTime() : '';
    sheet.appendRow([
      new Date(),
      level,
      event,
      typeof details === 'string' ? details : JSON.stringify(details || {}),
      elapsed,
      JSON.stringify(runContext.apiUsage),
      runContext.tokensUsed,
      successfulRunDate || ''
    ]);
  }

  function getLogSheet() {
    const ss = Config.spreadsheet();
    return Utils.getOrCreateSheet(ss, Config.all().sheets.logs, HEADERS);
  }

  return {
    startRun,
    incrementApi,
    addTokens,
    info,
    warn,
    error,
    success
  };
})();
