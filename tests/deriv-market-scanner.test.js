import test from "node:test";
import assert from "node:assert/strict";
import {
  DerivMarketScanner,
  supportsRiseFallDuration
} from "../src/data/deriv-market-scanner.js";
import { DERIV_PUBLIC_WS_URL, HISTORY_TICK_COUNT } from "../src/data/deriv-market-feed.js";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.sentAt = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(message) {
    this.sent.push(JSON.parse(message));
    this.sentAt.push(Date.now());
  }

  message(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const shortContracts = [
  { contract_type: "CALL", min_contract_duration: "15s", max_contract_duration: "1d" },
  { contract_type: "PUT", min_contract_duration: "15s", max_contract_duration: "1d" }
];

test("checks both directions and supported short contract durations", () => {
  assert.equal(supportsRiseFallDuration(shortContracts, 15), true);
  assert.equal(supportsRiseFallDuration(shortContracts, 60), true);
  assert.equal(supportsRiseFallDuration(shortContracts, 10), false);
  assert.equal(supportsRiseFallDuration(shortContracts.slice(0, 1), 15), false);
});

test("paces outgoing requests to the configured interval", async () => {
  FakeWebSocket.instances = [];
  const scanner = new DerivMarketScanner({
    WebSocketImpl: FakeWebSocket,
    requestIntervalMs: 40
  });
  scanner.start(15);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    req_id: 1,
    active_symbols: [
      { underlying_symbol: "R_100", exchange_is_open: 1 },
      { underlying_symbol: "R_50", exchange_is_open: 1 }
    ]
  });
  const deadline = Date.now() + 1000;
  while (socket.sent.filter((request) => request.contracts_for).length < 2 &&
      Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const requestIndexes = socket.sent
    .map((request, index) => request.contracts_for ? index : -1)
    .filter((index) => index >= 0);
  assert.equal(requestIndexes.length, 2);
  assert.ok(socket.sentAt[requestIndexes[1]] - socket.sentAt[requestIndexes[0]] >= 35);
  scanner.stop();
});

test("discovers open markets, filters unsupported expiries and imports 500 live ticks", () => {
  FakeWebSocket.instances = [];
  const closed = [];
  const scanner = new DerivMarketScanner({
    WebSocketImpl: FakeWebSocket,
    requestIntervalMs: 0,
    onClosedCandle: (event) => closed.push(event)
  });
  scanner.start(15);
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, DERIV_PUBLIC_WS_URL);
  socket.open();
  assert.deepEqual(socket.sent[0], {
    active_symbols: "brief",
    contract_type: ["CALL", "PUT"],
    req_id: 1
  });
  socket.message({
    req_id: 1,
    active_symbols: [
      { underlying_symbol: "R_100", exchange_is_open: 1, market: "synthetic_index" },
      { underlying_symbol: "R_50", exchange_is_open: 1, market: "synthetic_index" },
      { underlying_symbol: "R_25", exchange_is_open: 0 },
      { underlying_symbol: "R_10", exchange_is_open: 1, is_trading_suspended: true }
    ]
  });
  const contractRequests = socket.sent.filter((request) => request.contracts_for);
  assert.deepEqual(contractRequests.map((request) => request.contracts_for), ["R_100", "R_50"]);
  for (const request of contractRequests) {
    socket.message({
      req_id: request.req_id,
      contracts_for: {
        available: request.contracts_for === "R_100"
          ? shortContracts
          : [{ ...shortContracts[0], min_contract_duration: "1m" },
            { ...shortContracts[1], min_contract_duration: "1m" }]
      }
    });
  }
  const historyRequest = socket.sent.find((request) => request.ticks_history);
  assert.equal(historyRequest.ticks_history, "R_100");
  assert.equal(historyRequest.count, HISTORY_TICK_COUNT);
  socket.message({
    req_id: historyRequest.req_id,
    msg_type: "history",
    history: {
      times: [100, 102, 104, 105, 107, 110],
      prices: [1, 3, 2, 4, 5, 6]
    }
  });
  assert.equal(scanner.getSnapshot().status, "streaming");
  assert.equal(scanner.getSnapshot().ready, true);
  assert.equal(scanner.getSnapshot().readyCount, 1);
  assert.equal(scanner.getSnapshot().unsupportedCount, 1);
  socket.message({ msg_type: "tick", tick: { symbol: "R_100", epoch: 120, quote: 7 } });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].symbol, "R_100");
  assert.equal(closed[0].candle.timestamp, 105000);
  scanner.stop();
});

test("does not mark a partial market scan ready after a per-market API error", () => {
  FakeWebSocket.instances = [];
  const scanner = new DerivMarketScanner({
    WebSocketImpl: FakeWebSocket,
    requestIntervalMs: 0
  });
  scanner.start(15);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    req_id: 1,
    active_symbols: [{ underlying_symbol: "R_100", exchange_is_open: 1 }]
  });
  const contractsRequest = socket.sent.find((request) => request.contracts_for);
  socket.message({
    req_id: contractsRequest.req_id,
    contracts_for: { available: shortContracts }
  });
  const historyRequest = socket.sent.find((request) => request.ticks_history);
  socket.message({
    req_id: historyRequest.req_id,
    error: { message: "Rate limit exceeded" }
  });
  const snapshot = scanner.getSnapshot();
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.error, /Rate limit exceeded/);
  scanner.stop();
});
