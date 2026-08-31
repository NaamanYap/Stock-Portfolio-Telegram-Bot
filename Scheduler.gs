const Scheduler = (() => {
  function installWeekdayTrigger() {
    deleteTriggers('runDailyPortfolioIntelligence');
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY)
      .atHour(8)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.TUESDAY)
      .atHour(8)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
      .atHour(8)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.THURSDAY)
      .atHour(8)
      .create();
    ScriptApp.newTrigger('runDailyPortfolioIntelligence')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.FRIDAY)
      .atHour(8)
      .create();
    AppLogger.info('Triggers installed', 'Weekday 8 AM triggers created.');
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
    deleteTriggers
  };
})();
