export function advanceSignalLifecycle(signal, candle, candleIndex, {
  signalIndex, tolerance = 0, expiryCandles = 2
} = {}) {
  if (!Number.isInteger(expiryCandles) || expiryCandles < 1 || expiryCandles > 3) {
    throw new RangeError("Setup expiry must be from 1 through 3 candles");
  }
  if (signal.status !== "CONFIRMED" || candleIndex <= signalIndex || !candle.isClosed) return signal;
  const age = candleIndex - signalIndex;
  const reached = signal.direction === "bullish"
    ? candle.high >= signal.targetPrice
    : candle.low <= signal.targetPrice;
  const invalidated = signal.invalidationPrice !== null &&
    (signal.direction === "bullish"
      ? candle.close < signal.invalidationPrice - tolerance
      : candle.close > signal.invalidationPrice + tolerance);
  let status = signal.status;
  let terminalTimestamp = null;
  if (reached) {
    status = "TARGET_REACHED";
    terminalTimestamp = candle.timestamp + candle.timeframeSeconds * 1000;
  } else if (invalidated) {
    status = "INVALIDATED";
    terminalTimestamp = candle.timestamp + candle.timeframeSeconds * 1000;
  } else if (age >= expiryCandles) {
    status = "EXPIRED";
    terminalTimestamp = candle.timestamp + candle.timeframeSeconds * 1000;
  }
  return status === signal.status ? signal : { ...signal, status, terminalTimestamp };
}

export function resolveForecastOutcomes(signal, candles, signalIndex, tickSize = 0) {
  const outcomes = [...signal.outcomeRecords];
  for (const horizon of signal.forecastHorizons) {
    if (outcomes.some((record) => record.horizon === horizon)) continue;
    const observation = candles[signalIndex + horizon];
    if (!observation?.isClosed) continue;
    const difference = observation.close - signal.entryReference;
    const result = Math.abs(difference) <= tickSize ? "FLAT"
      : difference > 0 ? "UP" : "DOWN";
    outcomes.push({
      horizon,
      result,
      observedClose: observation.close,
      observationTimestamp: observation.timestamp + observation.timeframeSeconds * 1000
    });
  }
  return { ...signal, outcomeRecords: outcomes };
}
