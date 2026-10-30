import test from "node:test";
import assert from "node:assert/strict";
import {
  DERIV_PUBLIC_WS_URL,
  DerivMarketFeed,
  HISTORY_TICK_COUNT
} from "../src/data/deriv-market-feed.js";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  message(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

test("requests 500 public ticks and builds 15-second history bars", () => {
  FakeWebSocket.instances = [];
  const completed = [];
  const feed = new DerivMarketFeed({
    WebSocketImpl: FakeWebSocket,
    onClosedCandle: (candle) => completed.push(candle)
  });
  feed.start("R_100");
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, DERIV_PUBLIC_WS_URL);
  socket.open();
  assert.deepEqual(socket.sent[0], {
    ticks_history: "R_100",
    adjust_start_time: 1,
    count: HISTORY_TICK_COUNT,
    end: "latest",
    start: 1,
    style: "ticks",
    subscribe: 1
  });

  socket.message({
    msg_type: "history",
    history: {
      times: [100, 102, 104, 105, 107, 110],
      prices: [1, 3, 2, 4, 5, 6]
    },
    subscription: { id: "sub-1" }
  });
  const snapshot = feed.getSnapshot();
  assert.equal(snapshot.status, "streaming");
  assert.equal(snapshot.ticksLoaded, 6);
  assert.deepEqual(snapshot.candles.slice(0, 2).map((candle) => [
    candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume
  ]), [
    [90000, 1, 3, 1, 2, 3],
    [105000, 4, 6, 4, 6, 3]
  ]);
  assert.equal(snapshot.candles.at(-1).isClosed, false);
  assert.deepEqual(completed, []);

  socket.message({ msg_type: "tick", tick: { symbol: "R_100", epoch: 120, quote: 7 } });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].timestamp, 105000);
  feed.stop();
});

test("stops and reports an explicit Deriv error response", () => {
  FakeWebSocket.instances = [];
  const updates = [];
  const feed = new DerivMarketFeed({
    WebSocketImpl: FakeWebSocket,
    onUpdate: (snapshot) => updates.push(snapshot)
  });
  feed.start("R_100");
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({ error: { message: "Invalid symbol" } });
  assert.equal(feed.getSnapshot().status, "error");
  assert.match(updates.at(-1).error, /Invalid symbol/);
  assert.equal(feed.stopped, true);
});
