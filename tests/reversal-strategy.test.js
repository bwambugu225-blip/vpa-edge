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

function indicator(direction = "bullish") {
  return {
    ready: true,
    confirmed: true,
    direction,
    reason: "RSI/Bollinger confirmation"
  };
}

test("waits for baseline and requires matching reversal confirmations", () => {
  assert.equal(analyzeReversalSetup({ ready: false }).direction, "neutral");
  const setup = analyzeReversalSetup(analysis({
    rules: [{ id: "STOPPING_VOLUME", direction: "bullish" }]
  }), { indicator: indicator() });
  assert.equal(setup.direction, "neutral");
  assert.equal(setup.durationSeconds, null);
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
  }), { minimumRuleCount: 1, indicator: indicator("bearish") });
  assert.equal(setup.direction, "bearish");
  assert.deepEqual(setup.rules.map((rule) => rule.id), ["VOLUME_DIVERGENCE"]);
});

test("skips conflicting reversal evidence", () => {
  const setup = analyzeReversalSetup(analysis({
    rules: [
      { id: "STOPPING_VOLUME", direction: "bullish" },
      { id: "VOLUME_DIVERGENCE", direction: "bearish" }
    ]
  }), { minimumRuleCount: 1, indicator: indicator() });
  assert.equal(setup.direction, "neutral");
  assert.equal(setup.durationSeconds, null);
  assert.match(setup.reason, /Conflicting reversal evidence/);
});

test("requires matching RSI and Bollinger confirmation and defaults to 15 seconds", () => {
  const rules = [
    { id: "STOPPING_VOLUME", direction: "bullish" },
    { id: "SELLING_CLIMAX", direction: "bullish" }
  ];
  assert.equal(analyzeReversalSetup(analysis({ rules })).direction, "neutral");
  assert.equal(analyzeReversalSetup(analysis({ rules }), {
    indicator: indicator("bearish")
  }).direction, "neutral");
  const setup = analyzeReversalSetup(analysis({ rules }), { indicator: indicator() });
  assert.equal(setup.direction, "bullish");
  assert.equal(setup.durationSeconds, 15);
  assert.equal(analyzeReversalSetup(analysis({ rules }), {
    indicator: indicator(),
    durationSeconds: 30
  }).durationSeconds, 30);
  assert.throws(() => analyzeReversalSetup(analysis({ rules }), {
    indicator: indicator(),
    durationSeconds: 10
  }), /15, 30, or 60/);
});

test("deduplicates repeated VPA detections and validates the confirmation count", () => {
  const setup = analyzeReversalSetup(analysis({
    rules: [
      { id: "SELLING_CLIMAX", direction: "bullish" },
      { id: "SELLING_CLIMAX", direction: "bullish" }
    ]
  }), { minimumRuleCount: 1, indicator: indicator() });
  assert.equal(setup.rules.length, 1);
  assert.equal(setup.durationSeconds, 15);
  assert.throws(() => analyzeReversalSetup(analysis(), { minimumRuleCount: 0 }), /between 1 and 8/);
});
