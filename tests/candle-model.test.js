import test from "node:test";
import assert from "node:assert/strict";
import { candleGeometry, normalizeCandle, normalizeCandleSeries, validateCandleSeries } from "../src/data/candle-model.js";

const candle = (timestamp, values = {}) => ({
  timestamp, open: 10, high: 12, low: 9, close: 11, volume: null,
  isClosed: true, symbol: "TEST", timeframeSeconds: 60, volumeType: "unknown", ...values
});

test("validates OHLC, timestamp, volume, and timeframe", () => {
  assert.throws(() => normalizeCandle(candle(0, { high: 10 })), /OHLC/);
  assert.throws(() => normalizeCandle(candle(1.5)), /timestamp/);
  assert.throws(() => normalizeCandle(candle(60000, { volume: -1 })), /Volume/);
  assert.throws(() => normalizeCandle(candle(60000, { timeframeSeconds: 0 })), /timeframeSeconds/);
});

test("orders candles and resolves duplicate timestamps deterministically", () => {
  const result = normalizeCandleSeries([
    candle(120000), candle(60000), candle(120000, { close: 11.5 })
  ]);
  assert.deepEqual(result.map((item) => item.timestamp), [60000, 120000]);
  assert.equal(result[1].close, 11.5);
  assert.throws(() => normalizeCandleSeries([candle(60000), candle(60000)], { deduplicate: false }), /Duplicate/);
});

test("rejects mixed instrument series and identifies unaligned gaps", () => {
  assert.throws(() => normalizeCandleSeries([candle(60000), candle(120000, { symbol: "OTHER" })]), /one symbol/);
  assert.throws(() => normalizeCandleSeries([candle(60000), candle(90000)]), /timeframe-aligned/);
});

test("reports missing intervals without fabricating candles", () => {
  const validation = validateCandleSeries([candle(60000), candle(180000)]);
  assert.equal(validation.candles.length, 2);
  assert.equal(validation.gaps[0].missingIntervals, 1);
});

test("series diagnostics report duplicate and out-of-order inputs", () => {
  const result = validateCandleSeries([
    candle(120000), candle(60000), candle(120000, { close: 10.5 })
  ]);
  assert.deepEqual(result.duplicateTimestamps, [120000]);
  assert.equal(result.outOfOrder.length, 1);
});

test("zero-range geometry uses null ratios", () => {
  assert.equal(candleGeometry(candle(60000, { open: 10, high: 10, low: 10, close: 10 })).bodyRatio, null);
  assert.equal(candleGeometry(candle(60000)).closeLocation, 2 / 3);
});
