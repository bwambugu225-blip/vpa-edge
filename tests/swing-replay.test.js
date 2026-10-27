import test from "node:test";
import assert from "node:assert/strict";
import { findConfirmedSwings } from "../src/core/swing-engine.js";
import { replayCandles, replayStrategy } from "../src/core/point-in-time-replay.js";

function candle(index, high, low) {
  return {
    timestamp: (index + 1) * 60000, open: low + 0.2, high, low, close: high - 0.2,
    volume: null, isClosed: true, symbol: "T", timeframeSeconds: 60, volumeType: "unknown"
  };
}

test("swing confirmation timestamp is rightBars after pivot", () => {
  const source = [
    candle(0, 2, 0), candle(1, 3, 1), candle(2, 6, 2),
    candle(3, 4, 1), candle(4, 3, 0), candle(5, 3, 1)
  ];
  const swings = findConfirmedSwings(source, { leftBars: 2, rightBars: 2 });
  const high = swings.find((swing) => swing.type === "high");
  assert.equal(high.pivotIndex, 2);
  assert.equal(high.confirmationIndex, 4);
  assert.equal(high.confirmationTimestamp, source[4].timestamp);
});

test("replay events through t are invariant to changes after t", () => {
  const before = Array.from({ length: 30 }, (_, index) => candle(index, index + 2, index));
  const changedFuture = before.map((item, index) => index < 15 ? item : candle(index, 1000 + index, -1000));
  const left = replayCandles(before).slice(0, 15);
  const right = replayCandles(changedFuture).slice(0, 15);
  assert.deepEqual(left, right);
});

test("strategy decisions through t do not change when future candles are altered", () => {
  const source = Array.from({ length: 36 }, (_, index) => {
    const center = 100 + Math.sin(index / 2) * 3;
    return candle(index, center + 4, center - 4);
  });
  const altered = source.map((item, index) => index < 24
    ? item
    : candle(index, 1200 + index, 900 + index));
  const first = replayStrategy(source).decisions.slice(0, 24);
  const second = replayStrategy(altered).decisions.slice(0, 24);
  assert.deepEqual(first, second);
});
