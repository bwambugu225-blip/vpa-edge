const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_BOLLINGER_PERIOD = 20;

function calculateRsiSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length <= period) return result;

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain += Math.max(0, change);
    averageLoss += Math.max(0, -change);
  }
  averageGain /= period;
  averageLoss /= period;
  result[period] = rsiValue(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    result[index] = rsiValue(averageGain, averageLoss);
  }
  return result;
}

function rsiValue(averageGain, averageLoss) {
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  if (averageGain === 0) return 0;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function getBollingerBands(values, deviations) {
  const middle = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) =>
    sum + ((value - middle) ** 2), 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    lower: middle - deviations * standardDeviation,
    middle,
    upper: middle + deviations * standardDeviation
  };
}

export function analyzeOverboughtOversold(candles, {
  rsiPeriod = DEFAULT_RSI_PERIOD,
  bollingerPeriod = DEFAULT_BOLLINGER_PERIOD,
  standardDeviations = 2,
  oversold = 30,
  overbought = 70
} = {}) {
  if (!Array.isArray(candles)) throw new TypeError("Candles must be an array.");
  if (!Number.isSafeInteger(rsiPeriod) || rsiPeriod < 2 ||
      !Number.isSafeInteger(bollingerPeriod) || bollingerPeriod < 2 ||
      !Number.isFinite(standardDeviations) || standardDeviations <= 0 ||
      !Number.isFinite(oversold) || !Number.isFinite(overbought) ||
      oversold <= 0 || overbought >= 100 || oversold >= overbought) {
    throw new RangeError("Invalid RSI or Bollinger indicator settings.");
  }

  const completed = candles.filter((candle) => candle?.isClosed !== false);
  const requiredCandles = Math.max(bollingerPeriod + 1, rsiPeriod + 2);
  if (completed.length < requiredCandles) {
    return {
      ready: false,
      confirmed: false,
      direction: "neutral",
      rsi: null,
      percentB: null,
      bands: null,
      reason: `Waiting for ${requiredCandles} completed candles for RSI(${rsiPeriod}) and Bollinger(${bollingerPeriod}).`
    };
  }

  const closes = completed.map((candle) => Number(candle.close));
  if (closes.some((close) => !Number.isFinite(close))) {
    throw new TypeError("Completed candle closes must be finite numbers.");
  }

  const latest = completed.at(-1);
  const previous = completed.at(-2);
  const rsiSeries = calculateRsiSeries(closes, rsiPeriod);
  const rsi = rsiSeries.at(-1);
  const previousRsi = rsiSeries.at(-2);
  const bands = getBollingerBands(closes.slice(-bollingerPeriod - 1, -1), standardDeviations);
  const bandWidth = bands.upper - bands.lower;
  const percentB = bandWidth === 0 ? 0.5 : (closes.at(-1) - bands.lower) / bandWidth;
  const touchedLower = Number.isFinite(Number(latest.low)) &&
    Number(latest.low) <= bands.lower && closes.at(-1) > bands.lower;
  const touchedUpper = Number.isFinite(Number(latest.high)) &&
    Number(latest.high) >= bands.upper && closes.at(-1) < bands.upper;
  let direction = "neutral";
  let reason = `Waiting for a Bollinger Band rejection after RSI enters the ${oversold}/${overbought} extreme zone.`;

  if (touchedLower && previousRsi <= oversold && rsi > previousRsi && rsi < 50) {
    direction = "bullish";
    reason = `Lower Bollinger Band rejection with RSI recovering from oversold (${previousRsi.toFixed(1)} to ${rsi.toFixed(1)}).`;
  } else if (touchedUpper && previousRsi >= overbought && rsi < previousRsi && rsi > 50) {
    direction = "bearish";
    reason = `Upper Bollinger Band rejection with RSI retreating from overbought (${previousRsi.toFixed(1)} to ${rsi.toFixed(1)}).`;
  }

  return {
    ready: true,
    confirmed: direction !== "neutral",
    direction,
    rsi,
    previousRsi,
    percentB,
    bands,
    reason,
    candleTimestamp: latest.timestamp,
    previousCandleTimestamp: previous.timestamp
  };
}
