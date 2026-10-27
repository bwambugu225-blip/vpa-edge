import { normalizeCandleSeries } from "../data/candle-model.js";
import { analyzeStructure } from "./structure-engine.js";
import { indicatorSeries } from "./indicators.js";
import { evaluateSignalAt } from "./signal-engine.js";
import { advanceSignalLifecycle, resolveForecastOutcomes } from "./signal-state-machine.js";

export function replayCandles(input, { onCandle = null } = {}) {
  const candles = normalizeCandleSeries(input);
  const events = [];
  for (let index = 0; index < candles.length; index += 1) {
    const available = candles.slice(0, index + 1);
    const completed = available.filter((candle) => candle.isClosed);
    const indicators = indicatorSeries(completed);
    const structure = analyzeStructure(completed);
    const event = {
      timestamp: candles[index].timestamp,
      candleKey: `${candles[index].symbol}|${candles[index].timeframeSeconds}|${candles[index].timestamp}`,
      candleClosed: candles[index].isClosed,
      indicators: indicators.at(-1) ?? null,
      structure
    };
    events.push(event);
    onCandle?.(event, candles[index]);
  }
  return events;
}

export function replayStrategy(input, options = {}) {
  const normalized = normalizeCandleSeries(input);
  const candles = [];
  const signals = [];
  const signalIndices = new Map();
  const decisions = [];
  const events = [];
  const seenSignalKeys = new Set();
  for (const incoming of normalized) {
    if (!incoming.isClosed) continue;
    candles.push(incoming);
    const index = candles.length - 1;
    const decision = evaluateSignalAt(candles, index, {
      ...options,
      seenSignalKeys
    });
    decisions.push({
      timestamp: incoming.timestamp + incoming.timeframeSeconds * 1000,
      rejectionReasons: decision.rejections,
      signalIds: decision.signals.map((signal) => signal.id)
    });
    for (const signal of decision.signals) {
      signals.push(signal);
      signalIndices.set(signal.id, index);
      events.push({ type: "CONFIRMED", signalId: signal.id, timestamp: signal.signalTimestamp });
    }
    for (let signalIndex = 0; signalIndex < signals.length; signalIndex += 1) {
      const record = signals[signalIndex];
      const originalIndex = signalIndices.get(record.id);
      const updated = advanceSignalLifecycle(record, incoming, index, {
        signalIndex: originalIndex,
        tolerance: options.tickSize ?? 0,
        expiryCandles: options.expiryCandles ?? 2
      });
      const withOutcomes = resolveForecastOutcomes(updated, candles, originalIndex, options.tickSize ?? 0);
      if (withOutcomes.status !== record.status) {
        events.push({
          type: withOutcomes.status,
          signalId: record.id,
          timestamp: withOutcomes.terminalTimestamp
        });
      }
      signals[signalIndex] = withOutcomes;
    }
  }
  return { candles, decisions, signals, events };
}
