import test from "node:test";
import assert from "node:assert/strict";
import { analyzeReversalSetup } from "../src/core/reversal-strategy.js";

function analysis(overrides = {}) {
  return {
    ready: true,
    rules: [],
    nearSupport: true,
    nearResistance: true,
    relativeVolume: 1,
    rangeRatio: 1,
    ...overrides
  };
}

test("waits for baseline and requires matching reversal confirmations", () => {
  assert.equal(analyzeReversalSetup({ ready: false }).direction, "neutral");
  const setup = analyzeReversalSetup(analysis({
    rules: [{ id: "STOPPING_VOLUME", direction: "bullish" }]
  }));
  assert.equal(setup.direction, "neutral");
  assert.equal(setup.durationCandles, null);
  assert.match(setup.reason, /Need 2 matching reversal rules/);
});

test("filters reversal patterns by their relevant key level", () => {
  const setup = analyzeReversalSetup(analysis({
    nearSupport: false,
    nearResistance: true,
    rules: [
      { id: "STOPPING_VOLUME", direction: "bullish" },
      { id: "HIGH_VOLUME_PIN_BAR", direction: "bullish" },
      { id: "VOLUME_DIVERGENCE", direction: "bearish" },
      { id: "NO_SUPPLY", direction: "bullish" }
    ]
  }), { minimumRuleCount: 1 });
  assert.equal(setup.direction, "bearish");
  assert.deepEqual(setup.rules.map((rule) => rule.id), ["VOLUME_DIVERGENCE"]);
});

test("skips conflicting reversal evidence", () => {
  const setup = analyzeReversalSetup(analysis({
    rules: [
      { id: "STOPPING_VOLUME", direction: "bullish" },
      { id: "VOLUME_DIVERGENCE", direction: "bearish" }
    ]
  }), { minimumRuleCount: 1 });
  assert.equal(setup.direction, "neutral");
  assert.equal(setup.durationCandles, null);
  assert.match(setup.reason, /Conflicting reversal evidence/);
});

test("maps qualified evidence to adaptive one-to-five candle expiry", () => {
  const rules = [
    { id: "STOPPING_VOLUME", direction: "bullish" },
    { id: "SELLING_CLIMAX", direction: "bullish" },
    { id: "HIGH_VOLUME_PIN_BAR", direction: "bullish" },
    { id: "NO_SUPPLY", direction: "bullish" },
    { id: "BEARISH_EFFORT_LOWER_THAN_RESULT", direction: "bullish" },
    { id: "BEARISH_EFFORT_HIGHER_THAN_RESULT", direction: "bullish" }
  ];
  assert.equal(analyzeReversalSetup(analysis({ rules: rules.slice(0, 2) })).durationCandles, 2);
  assert.equal(analyzeReversalSetup(analysis({
    rules,
    relativeVolume: 2,
    rangeRatio: 1.4
  })).durationCandles, 5);
});

test("deduplicates repeated VPA detections and validates the confirmation count", () => {
  const setup = analyzeReversalSetup(analysis({
    rules: [
      { id: "SELLING_CLIMAX", direction: "bullish" },
      { id: "SELLING_CLIMAX", direction: "bullish" }
    ]
  }), { minimumRuleCount: 1 });
  assert.equal(setup.rules.length, 1);
  assert.equal(setup.durationCandles, 1);
  assert.throws(() => analyzeReversalSetup(analysis(), { minimumRuleCount: 0 }), /between 1 and 8/);
});
