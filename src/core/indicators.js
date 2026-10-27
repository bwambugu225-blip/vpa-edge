import { candleGeometry } from "../data/candle-model.js";

export function trueRanges(candles) {
  return candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
}

export function atrSeries(candles, period = 14) {
  if (!Number.isInteger(period) || period <= 0) throw new RangeError("ATR period must be positive");
  const ranges = trueRanges(candles);
  const result = Array(candles.length).fill(null);
  if (ranges.length < period) return result;
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = atr;
  for (let index = period; index < ranges.length; index += 1) {
    atr = ((period - 1) * atr + ranges[index]) / period;
    result[index] = atr;
  }
  return result;
}

export function emaSeries(values, period) {
  if (!Number.isInteger(period) || period <= 0) throw new RangeError("EMA period must be positive");
  const result = Array(values.length).fill(null);
  let run = [];
  let ema = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      run = [];
      ema = null;
      continue;
    }
    if (ema === null) {
      run.push(value);
      if (run.length === period) {
        ema = run.reduce((sum, item) => sum + item, 0) / period;
        result[index] = ema;
      }
    } else {
      const alpha = 2 / (period + 1);
      ema = alpha * value + (1 - alpha) * ema;
      result[index] = ema;
    }
  }
  return result;
}

export function rsiSeries(candles, period = 14) {
  if (!Number.isInteger(period) || period <= 0) throw new RangeError("RSI period must be positive");
  const result = Array(candles.length).fill(null);
  if (candles.length <= period) return result;
  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }
  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  const compute = () => averageLoss === 0
    ? (averageGain === 0 ? 50 : 100)
    : 100 - 100 / (1 + averageGain / averageLoss);
  result[period] = compute();
  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = compute();
  }
  return result;
}

export function relativeVolumeSeries(candles, period = 20) {
  if (!Number.isInteger(period) || period <= 0) throw new RangeError("Volume period must be positive");
  return candles.map((candle, index) => {
    if (candle.volume === null) {
      return { mean: null, relativeVolume: null, zScore: null, category: "unavailable" };
    }
    const previous = candles.slice(0, index).filter((item) => item.isClosed).slice(-period);
    if (previous.length < period || previous.some((item) => item.volume === null)) {
      return { mean: null, relativeVolume: null, zScore: null, category: "unavailable" };
    }
    const baseline = previous.map((item) => item.volume);
    const mean = baseline.reduce((sum, value) => sum + value, 0) / period;
    const variance = baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const relativeVolume = mean === 0 ? null : candle.volume / mean;
    const zScore = variance === 0 ? null : (candle.volume - mean) / Math.sqrt(variance);
    const category = relativeVolume === null ? "unavailable"
      : relativeVolume < 0.7 ? "low"
      : relativeVolume < 1.3 ? "ordinary"
      : relativeVolume < 1.8 ? "elevated" : "high";
    return { mean, relativeVolume, zScore, category };
  });
}

export function indicatorSeries(candles, { atrPeriod = 14, rsiPeriod = 14 } = {}) {
  const atr = atrSeries(candles, atrPeriod);
  const ranges = trueRanges(candles);
  const ema9 = emaSeries(candles.map((candle) => candle.close), 9);
  const ema21 = emaSeries(candles.map((candle) => candle.close), 21);
  const rsi = rsiSeries(candles, rsiPeriod);
  const relativeVolume = relativeVolumeSeries(candles);
  return candles.map((candle, index) => ({
    geometry: candleGeometry(candle),
    trueRange: ranges[index],
    atr: atr[index],
    ema9: ema9[index],
    ema21: ema21[index],
    rsi: rsi[index],
    relativeVolume: relativeVolume[index],
    emaSlope: index >= 3 && atr[index] > 0 &&
      ema9[index] !== null && ema9[index - 3] !== null
      ? (ema9[index] - ema9[index - 3]) / atr[index] : null
  }));
}
