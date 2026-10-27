import test from "node:test";
import assert from "node:assert/strict";
import { detectLiquiditySweep } from "../src/core/liquidity-engine.js";
import { scoreDirection } from "../src/core/signal-engine.js";

const makeCandle = (values = {}) => ({
  timestamp: 60000, open: 10, high: 11, low: 8.5, close: 10.8,
  volume: null, isClosed: true, symbol: "T", timeframeSeconds: 60,
  volumeType: "unknown", ...values
});

test("bullish liquidity sweep requires reclaim and a closed candle", () => {
  const swing = { type: "low", pivotPrice: 9 };
  assert.equal(detectLiquiditySweep(makeCandle(), swing, 2)?.type, "bullish-sweep");
  assert.equal(detectLiquiditySweep(makeCandle({ close: 8.9 }), swing, 2), null);
  assert.equal(detectLiquiditySweep(makeCandle({ isClosed: false }), swing, 2), null);
});

test("missing volume is excluded from the score denominator", () => {
  const input = {
    bias: "bullish",
    bos: { type: "bullish-BOS" },
    choch: null,
    sweep: null,
    patterns: {
      bullishEngulfing: true, bearishEngulfing: false,
      bullishRejection: false, bearishRejection: false
    },
    candle: { open: 10, close: 11 },
    geometry: { bodyRatio: 0.8, closeLocation: 0.9, range: 2 },
    volume: { relativeVolume: null },
    ema9: 12, ema21: 11, emaSlope: 1,
    regime: "bullish",
    setupType: "STRUCTURAL_BREAKOUT"
  };
  const score = scoreDirection("bullish", input);
  assert.equal(score.availableMaximum, 85);
  assert.equal(score.points, 62);
  assert.equal(score.normalizedScore, 100 * 62 / 85);
  const unavailableSlope = scoreDirection("bullish", { ...input, emaSlope: null });
  assert.equal(unavailableSlope.components.momentum.points, 0);
});
