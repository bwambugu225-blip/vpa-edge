import test from "node:test";
import assert from "node:assert/strict";
import { advanceSignalLifecycle, resolveForecastOutcomes } from "../src/core/signal-state-machine.js";

const signal = {
  id: "s", status: "CONFIRMED", direction: "bullish", targetPrice: 12,
  invalidationPrice: 9, entryReference: 10, outcomeRecords: [], forecastHorizons: [1, 2, 3]
};
const candle = (timestamp, values = {}) => ({
  timestamp, timeframeSeconds: 60, isClosed: true, high: 11, low: 9.5, close: 10.5, ...values
});

test("target touch takes priority over same-candle invalidation", () => {
  const updated = advanceSignalLifecycle(signal, candle(120000, { high: 12.5, close: 8 }), 2, {
    signalIndex: 0, expiryCandles: 2
  });
  assert.equal(updated.status, "TARGET_REACHED");
});

test("forecast outcomes resolve only when the future horizon exists", () => {
  const candles = [candle(60000), candle(120000, { close: 10.5 })];
  const updated = resolveForecastOutcomes(signal, candles, 0);
  assert.deepEqual(updated.outcomeRecords, [{
    horizon: 1, result: "UP", observedClose: 10.5, observationTimestamp: 180000
  }]);
});
