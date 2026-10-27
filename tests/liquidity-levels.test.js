import test from "node:test";
import assert from "node:assert/strict";
import { equalLiquidityLevels } from "../src/core/liquidity-engine.js";

test("equal liquidity uses pivots within the latest 50 candles", () => {
  const candles = Array.from({ length: 51 }, (_, index) => ({
    timestamp: (index + 1) * 60000
  }));
  const swings = [
    { type: "high", pivotPrice: 10, pivotTimestamp: candles[0].timestamp, confirmationIndex: 4 },
    { type: "high", pivotPrice: 10.01, pivotTimestamp: candles[1].timestamp, confirmationIndex: 5 },
    { type: "high", pivotPrice: 10.02, pivotTimestamp: candles[49].timestamp, confirmationIndex: 50 }
  ];
  const levels = equalLiquidityLevels(swings, candles, 50, { tickSize: 0.05 });
  assert.equal(levels.length, 1);
  assert.equal(levels[0].type, "equal-highs");
  assert.equal(levels[0].throughTimestamp, candles[50].timestamp);
});
