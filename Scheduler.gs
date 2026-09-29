const Scheduler = (() => {
  function installWeekdayTrigger() {
    deleteTriggers('runDailyPortfolioIntelligence');
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY)
      .atHour(7)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.TUESDAY)
      .atHour(7)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
      .atHour(7)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.THURSDAY)
      .atHour(7)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.FRIDAY)
      .atHour(7)
      .create();
    AppLogger.info('Triggers installed', 'Weekday 7 AM triggers created.');
  }

  // Hourly, every day: crypto trades at weekends and markets in other
  // timezones close at different hours, so the Mini App needs more than the
  // weekday-morning briefing to stay current. One quote call per holding.
  function installSnapshotTrigger() {
    deleteTriggers('refreshPortfolioSnapshot');
    ScriptApp.newTrigger('refreshPortfolioSnapshot')
      .timeBased()
      .everyHours(1)
      .create();
    AppLogger.info('Triggers installed', 'Hourly portfolio snapshot trigger created.');
  }

  /** One-off trigger; the target deletes its own trigger when it runs. */
  function scheduleOnce(functionName, delayMs) {
    ScriptApp.newTrigger(functionName).timeBased().after(delayMs).create();
  }

  function deleteTriggers(functionName) {
    ScriptApp.getProjectTriggers().forEach((trigger) => {
      if (!functionName || trigger.getHandlerFunction() === functionName) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  return {
    installWeekdayTrigger,
    installSnapshotTrigger,
    scheduleOnce,
    deleteTriggers
  };
})();
