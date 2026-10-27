import test from "node:test";
import assert from "node:assert/strict";
import { TickCandleAggregator } from "../src/data/tick-candle-aggregator.js";

test("aggregates ticks into aligned five-second OHLC bars with tick volume", () => {
  const aggregator = new TickCandleAggregator({ symbol: "R_100" });
  aggregator.addTick({ epoch: 100, quote: 10 });
  aggregator.addTick({ epoch: 102, quote: 12 });
  aggregator.addTick({ epoch: 104, quote: 9 });
  aggregator.addTick({ epoch: 105, quote: 11 });

  const [closed, current] = aggregator.getCandles();
  assert.deepEqual(
    [closed.timestamp, closed.open, closed.high, closed.low, closed.close, closed.volume],
    [100000, 10, 12, 9, 9, 3]
  );
  assert.equal(closed.isClosed, true);
  assert.equal(closed.volumeType, "tick");
  assert.equal(current.timestamp, 105000);
  assert.equal(current.isClosed, false);
  assert.deepEqual(aggregator.getCandles({ includeCurrent: false }), [closed]);
});

test("ignores late ticks and limits retained completed candles", () => {
  const aggregator = new TickCandleAggregator({ symbol: "R_100", maxCandles: 2 });
  for (const epoch of [0, 5, 10, 15]) {
    aggregator.addTick({ epoch, quote: epoch });
  }
  assert.equal(aggregator.addTick({ epoch: 5, quote: 100 }), false);
  assert.deepEqual(aggregator.getCandles().map((candle) => candle.timestamp), [
    5000, 10000, 15000
  ]);
});

test("rejects invalid symbols and tick values", () => {
  assert.throws(() => new TickCandleAggregator({ symbol: "bad symbol" }), /Symbol/);
  const aggregator = new TickCandleAggregator({ symbol: "R_100" });
  assert.throws(() => aggregator.addTick({ epoch: -1, quote: 10 }), /epoch/);
  assert.throws(() => aggregator.addTick({ epoch: 1, quote: NaN }), /quote/);
});
