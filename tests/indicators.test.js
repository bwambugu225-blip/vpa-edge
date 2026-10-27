import test from "node:test";
import assert from "node:assert/strict";
import { atrSeries, emaSeries, relativeVolumeSeries, rsiSeries } from "../src/core/indicators.js";

const candles = (closes) => closes.map((close, index) => ({
  timestamp: (index + 1) * 60000, open: close, high: close + 1, low: close - 1,
  close, volume: 2, isClosed: true, symbol: "T", timeframeSeconds: 60, volumeType: "tick"
}));

test("ATR seeds from first period and uses Wilder recurrence", () => {
  const source = candles([1, 2, 3, 4]);
  const values = atrSeries(source, 3);
  assert.equal(values[1], null);
  assert.equal(values[2], 2);
  assert.equal(values[3], (2 * 2 + 2) / 3);
});

test("EMA uses an arithmetic seed then exponential recurrence", () => {
  assert.deepEqual(emaSeries([1, 2, 3, 4], 3), [null, null, 2, 3]);
});

test("RSI handles all-gain and unchanged series", () => {
  assert.equal(rsiSeries(candles([1, 2, 3, 4]), 2)[2], 100);
  assert.equal(rsiSeries(candles([5, 5, 5]), 2)[2], 50);
});

test("relative volume uses only preceding observations", () => {
  const source = candles(Array(22).fill(1));
  source.forEach((item, index) => { item.volume = index < 20 ? 2 : index === 20 ? 4 : 8; });
  const values = relativeVolumeSeries(source, 20);
  assert.equal(values[19].relativeVolume, null);
  assert.equal(values[20].relativeVolume, 2);
  assert.equal(values[21].relativeVolume, 8 / 2.1);
  assert.equal(values[20].category, "high");
});

test("relative volume baseline excludes unfinished preceding candles", () => {
  const source = candles(Array(21).fill(1));
  source[19].isClosed = false;
  source[19].volume = 500;
  assert.equal(relativeVolumeSeries(source, 20)[20].relativeVolume, null);
});
