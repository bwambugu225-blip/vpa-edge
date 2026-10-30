import test from "node:test";
import assert from "node:assert/strict";
import { analyzeOverboughtOversold } from "../src/core/overbought-oversold-indicator.js";

function rejectionCandles(direction) {
  const candles = Array.from({ length: 36 }, (_, index) => ({
    timestamp: (index + 1) * 5000,
    open: 100,
    high: 100.1,
    low: 99.9,
    close: 100,
    isClosed: true
  }));
  const extremes = direction === "bullish"
    ? [99.5, 99, 98, 99]
    : [100.5, 101, 102, 101];
  for (const [index, close] of extremes.entries()) {
    const previous = candles.at(-1);
    candles.push({
      timestamp: previous.timestamp + 5000,
      open: previous.close,
      high: Math.max(previous.close, close) + (index === extremes.length - 1 ? 0.5 : 0.1),
      low: Math.min(previous.close, close) - (index === extremes.length - 1 ? 0.5 : 0.1),
      close,
      isClosed: true
    });
  }
  return candles;
}

test("confirms oversold lower-band rejection only after a completed candle", () => {
  const candles = rejectionCandles("bullish");
  const result = analyzeOverboughtOversold(candles);
  assert.equal(result.ready, true);
  assert.equal(result.direction, "bullish");
  assert.equal(result.confirmed, true);
  assert.ok(result.previousRsi <= 30);
  assert.ok(result.percentB > 0);

  const ignored = analyzeOverboughtOversold([
    ...candles,
    { ...candles.at(-1), timestamp: candles.at(-1).timestamp + 5000, isClosed: false, close: 100 }
  ]);
  assert.equal(ignored.candleTimestamp, result.candleTimestamp);
  assert.equal(ignored.rsi, result.rsi);
});

test("confirms overbought upper-band rejection with weakening RSI", () => {
  const result = analyzeOverboughtOversold(rejectionCandles("bearish"));
  assert.equal(result.ready, true);
  assert.equal(result.direction, "bearish");
  assert.equal(result.confirmed, true);
  assert.ok(result.previousRsi >= 70);
});

test("waits for sufficient closed-candle history and validates settings", () => {
  const result = analyzeOverboughtOversold(rejectionCandles("bullish").slice(0, 10));
  assert.equal(result.ready, false);
  assert.match(result.reason, /completed candles/);
  assert.throws(() => analyzeOverboughtOversold([], { rsiPeriod: 1 }), /Invalid RSI/);
});
