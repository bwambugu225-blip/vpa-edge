import { resolveForecastOutcomes } from "./signal-state-machine.js";

export function evaluateOutcomes(signals, candles, { tickSize = 0 } = {}) {
  const candleIndices = new Map(candles.map((candle, index) => [candle.timestamp, index]));
  return signals.map((signal) => {
    const signalIndex = candleIndices.get(signal.signalCandleTimestamp);
    if (signalIndex === undefined) return signal;
    return resolveForecastOutcomes(signal, candles, signalIndex, tickSize);
  });
}

export function summarizeOutcomes(signals, horizon) {
  const records = signals.flatMap((signal) => signal.outcomeRecords
    .filter((outcome) => outcome.horizon === horizon)
    .map((outcome) => ({ direction: signal.direction, ...outcome })));
  const directional = records.filter((record) => record.result !== "FLAT");
  const correct = directional.filter((record) =>
    record.result === (record.direction === "bullish" ? "UP" : "DOWN")).length;
  return {
    horizon,
    sampleSize: records.length,
    flat: records.filter((record) => record.result === "FLAT").length,
    directionalAccuracy: directional.length ? correct / directional.length : null,
    confusionMatrix: {
      UP: {
        predictedBullish: directional.filter((r) => r.direction === "bullish" && r.result === "UP").length,
        predictedBearish: directional.filter((r) => r.direction === "bearish" && r.result === "UP").length
      },
      DOWN: {
        predictedBullish: directional.filter((r) => r.direction === "bullish" && r.result === "DOWN").length,
        predictedBearish: directional.filter((r) => r.direction === "bearish" && r.result === "DOWN").length
      }
    }
  };
}
