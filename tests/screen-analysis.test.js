import test from "node:test";
import assert from "node:assert/strict";
import "../src/content/screen-analysis.js";

const {
  analyzeVisibleScreen,
  extractVisibleCandles,
  parseVisibleOhlc,
  scoreVisibleSignals
} =
  globalThis.VPAEdgeScreenAnalysis;

function makeChartImage(width = 80, height = 60) {
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, [r, g, b]) => {
    const index = (y * width + x) * 4;
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  };
  const drawCandle = ({ x, high, bodyTop, bodyBottom, low, color }) => {
    for (let y = bodyTop; y <= bodyBottom; y += 1) {
      for (let column = x; column < x + 4; column += 1) {
        setPixel(column, y, color);
      }
    }
    for (let y = high; y <= low; y += 1) setPixel(x + 2, y, color);
  };

  drawCandle({
    x: 8, high: 10, bodyTop: 18, bodyBottom: 28, low: 35,
    color: [8, 153, 129]
  });
  drawCandle({
    x: 24, high: 14, bodyTop: 20, bodyBottom: 32, low: 37,
    color: [242, 54, 69]
  });
  drawCandle({
    x: 40, high: 8, bodyTop: 16, bodyBottom: 21, low: 29,
    color: [8, 153, 129]
  });
  for (let x = 0; x < width; x += 2) setPixel(x, 42, [8, 153, 129]);
  return { width, height, data };
}

test("extracts approximate visible candle geometry and direction", () => {
  const image = makeChartImage();
  const candles = extractVisibleCandles(image);
  assert.equal(candles.length, 3);
  assert.deepEqual(candles.map((candle) => candle.direction), [
    "bullish", "bearish", "bullish"
  ]);
  assert.equal(candles[0].highY, 10);
  assert.equal(candles[0].lowY, 35);
  assert.equal(candles[0].closeY, 18);
});

test("summarizes only visible bars and identifies relative screen direction", () => {
  const result = analyzeVisibleScreen(makeChartImage());
  assert.equal(result.visibleBarCount, 3);
  assert.equal(result.bullishCount, 2);
  assert.equal(result.bearishCount, 1);
  assert.equal(result.trend, "up on screen");
  assert.match(result.note, /not recovered prices/);
  assert.equal(result.annotations.length, result.visibleBarCount);
});

test("scores visible range breaks and strong candle shapes", () => {
  const chart = {
    x: 20,
    direction: "bullish",
    highY: 30,
    lowY: 50,
    openY: 45,
    closeY: 32,
    bodyRatio: 0.65,
    upperWickRatio: 0.1,
    lowerWickRatio: 0.25,
    closeLocation: 0.9
  };
  const previous = [40, 38, 36].map((highY, index) => ({
    ...chart,
    x: index * 10,
    highY,
    lowY: highY + 30,
    openY: highY + 18,
    closeY: highY + 20,
    bodyRatio: 0.1,
    direction: "bearish"
  }));
  const scored = scoreVisibleSignals([...previous, chart]);
  assert.equal(scored.at(-1).signal, "bullish");
  assert.ok(scored.at(-1).reasons.includes("visible range break"));
});

test("parses a consistent visible OHLC header without claiming it is latest", () => {
  assert.deepEqual(
    parseVisibleOhlc("R_25\nO 1,234.5 H 1,240 L 1,220 C 1,238"),
    { open: 1234.5, high: 1240, low: 1220, close: 1238 }
  );
  assert.equal(parseVisibleOhlc("O 10 H 9 L 8 C 10"), null);
  assert.equal(parseVisibleOhlc("No OHLC text here"), null);
});

test("rejects malformed canvas image data", () => {
  assert.throws(
    () => extractVisibleCandles({ width: 2, height: 2, data: new Uint8Array(4) }),
    TypeError
  );
});
