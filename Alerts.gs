const Alerts = (() => {
  function buildAlerts(enrichedHoldings, newsByTicker) {
    return enrichedHoldings.reduce((alerts, holding) => {
      const tickerAlerts = [];
      const settings = Config.all();

      if (Math.abs(Number(holding.dailyChangePercent || 0)) >= settings.alertMovePercent) {
        tickerAlerts.push({
          type: 'Price move',
          message: `${holding.ticker} moved ${Utils.percent(holding.dailyChangePercent)} today.`
        });
      }

      if (holding.earningsDate) {
        const daysToEarnings = Utils.daysBetween(new Date(), new Date(`${holding.earningsDate}T00:00:00Z`));
        if (daysToEarnings >= 0 && daysToEarnings <= settings.earningsWindowDays) {
          tickerAlerts.push({
            type: 'Upcoming earnings',
            message: `${holding.ticker} reports earnings on ${holding.earningsDate}.`
          });
        }
      }

      const volume = Number(holding.volume || 0);
      const averageVolume = Number(holding.averageVolume || 0);
      if (volume && averageVolume && volume / averageVolume >= settings.unusualVolumeRatio) {
        tickerAlerts.push({
          type: 'Unusual volume',
          message: `${holding.ticker} volume is ${Utils.round(volume / averageVolume, 1)}x its average.`
        });
      }

      News.extractNewsAlerts(newsByTicker[holding.ticker] || []).forEach((alert) => {
        tickerAlerts.push({
          type: alert.type,
          message: `${holding.ticker}: ${alert.headline}`,
          url: alert.url
        });
      });

      if (tickerAlerts.length) {
        alerts[holding.ticker] = tickerAlerts;
      }
      return alerts;
    }, {});
  }

  return {
    buildAlerts
  };
})();
