import test from "node:test";
import assert from "node:assert/strict";
import { detectStructureEvents } from "../src/core/structure-events.js";

function candle(index, open, high, low, close) {
  return {
    timestamp: (index + 1) * 60000, open, high, low, close, volume: null,
    isClosed: true, symbol: "T", timeframeSeconds: 60, volumeType: "unknown"
  };
}

const prior = [
  candle(0, 1, 2, 0, 1.5),
  candle(1, 2, 3, 0.5, 2.5),
  candle(2, 3, 4, 0.8, 3.5),
  candle(3, 4, 6, 1, 5.5),
  candle(4, 5, 5.5, 0.8, 4.5),
  candle(5, 4, 4.5, 0.5, 4)
];

test("wick-only breach does not qualify as a bullish BOS", () => {
  assert.deepEqual(detectStructureEvents(prior, candle(6, 4.5, 7, 3.5, 5.5)), []);
});

test("close crossing a previously confirmed swing high qualifies as BOS", () => {
  const events = detectStructureEvents(prior, candle(6, 5.5, 6.5, 5, 6.2));
  assert.equal(events[0]?.type, "bullish-BOS");
  assert.equal(events[0]?.brokenLevel, 6);
});
