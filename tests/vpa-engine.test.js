import test from "node:test";
import assert from "node:assert/strict";
import { analyzeVpa } from "../src/core/vpa-engine.js";

function history(count = 20, overrides = () => ({})) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: (index + 1) * 5000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    isClosed: true,
    symbol: "R_100",
    timeframeSeconds: 5,
    volumeType: "tick",
    ...overrides(index)
  }));
}

test("waits for a completed candle and sufficient VPA baseline", () => {
  assert.equal(analyzeVpa([]).ready, false);
  const warming = analyzeVpa(history(5));
  assert.equal(warming.ready, false);
  assert.match(warming.reason, /4\/10/);
});

test("detects the absorption trap at support", () => {
  const bars = history();
  bars.push({
    ...bars.at(-1),
    timestamp: 105000,
    open: 99.1,
    high: 99.3,
    low: 99,
    close: 99.15,
    volume: 30
  });
  const result = analyzeVpa(bars);
  assert.ok(result.rules.some((rule) => rule.id === "ABSORPTION_TRAP" && rule.direction === "bullish"));
});

test("detects stopping volume, selling climax, and bullish high-volume pin bars", () => {
  const stopping = history();
  stopping.push({ ...stopping.at(-1), timestamp: 105000, open: 102, high: 103, low: 96, close: 100.5, volume: 30 });
  assert.ok(analyzeVpa(stopping).rules.some((rule) => rule.id === "STOPPING_VOLUME"));
  assert.ok(analyzeVpa(stopping).rules.some((rule) => rule.id === "SELLING_CLIMAX"));

  const pin = history();
  pin.push({ ...pin.at(-1), timestamp: 105000, open: 100, high: 101.2, low: 98, close: 101, volume: 30 });
  assert.ok(analyzeVpa(pin).rules.some((rule) => rule.id === "HIGH_VOLUME_PIN_BAR"));
});

test("detects extreme-volume warnings and volume divergence at highs", () => {
  const rising = history(20, (index) => ({
    close: 100 + index,
    open: 99 + index,
    high: 101 + index,
    low: 98 + index,
    volume: 10
  }));
  rising.push({ ...rising.at(-1), timestamp: 105000, open: 120, high: 121, low: 119, close: 120.5, volume: 30 });
  const warning = analyzeVpa(rising);
  assert.ok(warning.rules.some((rule) =>
    rule.id === "EXTREME_VOLUME_WARNING" && rule.direction === "bearish"));

  const divergence = history(20, (index) => ({
    high: index === 18 ? 103 : 101,
    volume: index === 18 ? 30 : 10
  }));
  divergence.push({
    ...divergence.at(-1),
    timestamp: 105000,
    open: 100,
    high: 104,
    low: 99,
    close: 103,
    volume: 8
  });
  assert.ok(analyzeVpa(divergence).rules.some((rule) => rule.id === "VOLUME_DIVERGENCE"));
});

test("detects both bearish-effort exhaustion patterns and no-supply bars", () => {
  const exhaustion = history();
  exhaustion.push({ ...exhaustion.at(-1), timestamp: 105000, open: 100, high: 100.1, low: 97, close: 98, volume: 5 });
  const exhaustionResult = analyzeVpa(exhaustion);
  assert.ok(exhaustionResult.rules.some((rule) => rule.id === "BEARISH_EFFORT_LOWER_THAN_RESULT"));

  const absorption = history();
  absorption.push({ ...absorption.at(-1), timestamp: 105000, open: 100, high: 100.1, low: 99.9, close: 99.95, volume: 30 });
  const absorptionResult = analyzeVpa(absorption);
  assert.ok(absorptionResult.rules.some((rule) => rule.id === "BEARISH_EFFORT_HIGHER_THAN_RESULT"));

  const noSupply = history();
  noSupply.push({ ...noSupply.at(-1), timestamp: 105000, open: 100, high: 100.05, low: 99.9, close: 99.95, volume: 5 });
  assert.ok(analyzeVpa(noSupply).rules.some((rule) => rule.id === "NO_SUPPLY"));
});

test("reports the VPA pre-trade checklist and preserves tick-volume caveat", () => {
  const bars = history();
  bars.push({ ...bars.at(-1), timestamp: 105000, open: 100, high: 102, low: 99, close: 101, volume: 20 });
  const result = analyzeVpa(bars);
  assert.equal(result.checklist.volumeIncreasing, true);
  assert.equal(result.checklist.unusualVolume, true);
  assert.equal(result.volumeType, "tick");
  assert.equal(result.ready, true);
});
