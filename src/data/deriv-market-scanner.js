import { TickCandleAggregator } from "./tick-candle-aggregator.js";
import {
  CANDLE_TIMEFRAME_SECONDS,
  DERIV_PUBLIC_WS_URL,
  HISTORY_TICK_COUNT
} from "./deriv-market-feed.js";

const REQUEST_TIMEOUT_MS = 20000;
const MAX_BUFFERED_TICKS = 1000;
const DEFAULT_REQUEST_INTERVAL_MS = 350;
const INACTIVITY_TIMEOUT_MS = 90000;
const STABLE_CONNECTION_MS = 30000;

function isTransientConnectionError(message) {
  return /rate.?limit|temporar|timed? out|connection|server|unavailable|too many requests/i.test(message);
}

function durationInSeconds(value) {
  const match = /^(\d+(?:\.\d+)?)([smhd])$/.exec(String(value ?? ""));
  if (!match) return null;
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2]];
}

export function supportsRiseFallDuration(contracts, durationSeconds) {
  if (!Array.isArray(contracts) || !Number.isSafeInteger(durationSeconds) ||
      durationSeconds <= 0) return false;
  return ["CALL", "PUT"].every((type) => contracts.some((contract) => {
    if (contract.contract_type !== type) return false;
    const minimum = durationInSeconds(contract.min_contract_duration);
    const maximum = durationInSeconds(contract.max_contract_duration);
    return minimum !== null && maximum !== null &&
      minimum <= durationSeconds && durationSeconds <= maximum;
  }));
}

export class DerivMarketScanner {
  constructor({
    WebSocketImpl = globalThis.WebSocket,
    onUpdate = () => {},
    onClosedCandle = () => {},
    requestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS
  } = {}) {
    if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is unavailable");
    if (!Number.isSafeInteger(requestIntervalMs) || requestIntervalMs < 0) {
      throw new RangeError("requestIntervalMs must be a nonnegative integer.");
    }
    this.WebSocketImpl = WebSocketImpl;
    this.onUpdate = onUpdate;
    this.onClosedCandle = onClosedCandle;
    this.requestIntervalMs = requestIntervalMs;
    this.socket = null;
    this.retryTimer = null;
    this.requestTimer = null;
    this.inactivityTimer = null;
    this.stabilityTimer = null;
    this.lastMessageAt = 0;
    this.stopped = true;
    this.attempt = 0;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.requestQueue = [];
    this.lastRequestAt = 0;
    this.markets = new Map();
    this.durationSeconds = 15;
    this.status = "disconnected";
    this.error = null;
  }

  start(durationSeconds = 15) {
    if (!Number.isSafeInteger(durationSeconds) || ![15, 30, 60].includes(durationSeconds)) {
      throw new RangeError("Choose a 15, 30, or 60 second contract expiry.");
    }
    this.stop();
    this.durationSeconds = durationSeconds;
    this.stopped = false;
    this.attempt = 0;
    this.nextRequestId = 1;
    this.lastRequestAt = 0;
    this.clearPending();
    this.markets.clear();
    this.error = null;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearConnectionTimers();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearPending();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close();
    this.status = "disconnected";
    this.publish();
  }

  reconnectNow(error = "Network changed; reconnecting market scanner.") {
    if (this.stopped) return;
    this.clearConnectionTimers();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.clearPending();
    if (socket && socket.readyState < 2) socket.close();
    this.status = "reconnecting";
    this.error = error;
    this.publish();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.markets.clear();
      this.connect();
    }, 0);
  }

  reconnectIfStale() {
    if (this.stopped) return;
    const socketOpen = this.socket?.readyState === 1;
    if (!socketOpen || Date.now() - this.lastMessageAt > INACTIVITY_TIMEOUT_MS) {
      this.reconnectNow("Market scanner was idle; reconnecting.");
    }
  }

  clearConnectionTimers() {
    for (const key of ["inactivityTimer", "stabilityTimer"]) {
      if (this[key] !== null) clearTimeout(this[key]);
      this[key] = null;
    }
  }

  armInactivityTimer(socket) {
    if (this.inactivityTimer !== null) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (socket !== this.socket || this.stopped) return;
      this.disconnect(socket, "Market scanner stopped updating; reconnecting.");
    }, INACTIVITY_TIMEOUT_MS);
  }

  getSnapshot() {
    const markets = [...this.markets.values()];
    const readyCount = markets.filter((market) => market.status === "streaming").length;
    const pendingCount = markets.filter((market) =>
      ["loading_contracts", "loading_history"].includes(market.status)).length;
    const errorCount = markets.filter((market) => market.status === "error").length;
    return {
      status: this.status,
      error: this.error,
      durationSeconds: this.durationSeconds,
      ready: markets.length > 0 && pendingCount === 0 && readyCount > 0 && errorCount === 0,
      readyCount,
      pendingCount,
      unsupportedCount: markets.filter((market) => market.status === "unsupported").length,
      errorCount,
      total: markets.length,
      markets: markets.map(({ symbol, name, market, status, ticksLoaded, lastQuote, error }) => ({
        symbol,
        name,
        market,
        status,
        ticksLoaded,
        lastQuote,
        error
      }))
    };
  }

  connect() {
    if (this.stopped) return;
    this.status = this.attempt ? "reconnecting" : "connecting";
    this.error = null;
    this.publish();
    let socket;
    try {
      socket = new this.WebSocketImpl(DERIV_PUBLIC_WS_URL);
    } catch (error) {
      this.scheduleReconnect(error.message);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.lastMessageAt = Date.now();
      this.status = "loading_markets";
      this.publish();
      this.armInactivityTimer(socket);
      this.sendRequest({
        active_symbols: "brief",
        contract_type: ["CALL", "PUT"]
      }, "active_symbols");
    };
    socket.onmessage = (event) => {
      if (socket === this.socket) {
        this.lastMessageAt = Date.now();
        this.armInactivityTimer(socket);
        this.handleMessage(event.data);
      }
    };
    socket.onerror = () => {
      this.disconnect(socket, "Scanner connection interrupted; reconnecting.");
    };
    socket.onclose = () => {
      if (socket === this.socket && !this.stopped) {
        this.socket = null;
        this.clearConnectionTimers();
        this.clearPending();
        this.scheduleReconnect("Scanner connection closed; reconnecting.");
      }
    };
  }

  disconnect(socket, error) {
    if (socket !== this.socket || this.stopped) return;
    this.socket = null;
    this.clearConnectionTimers();
    this.clearPending();
    if (socket.readyState < 2) socket.close();
    this.scheduleReconnect(error);
  }

  sendRequest(payload, type, symbol = null) {
    const requestId = this.nextRequestId++;
    this.pending.set(requestId, { type, symbol, timeout: null, payload });
    this.requestQueue.push(requestId);
    this.flushRequests();
  }

  flushRequests() {
    if (this.stopped || !this.socket || this.socket.readyState !== 1 ||
        !this.requestQueue.length || this.requestTimer !== null) return;
    const wait = Math.max(0, this.requestIntervalMs - (Date.now() - this.lastRequestAt));
    if (wait > 0) {
      this.requestTimer = setTimeout(() => {
        this.requestTimer = null;
        this.flushRequests();
      }, wait);
      return;
    }
    const requestId = this.requestQueue.shift();
    const request = this.pending.get(requestId);
    if (!request) {
      this.flushRequests();
      return;
    }
    request.timeout = setTimeout(() => {
      if (!this.pending.has(requestId)) return;
      this.pending.delete(requestId);
      if (request.type === "active_symbols") {
        this.disconnect(this.socket, "Timed out while discovering Deriv markets.");
        return;
      }
      this.disconnect(this.socket, `Timed out loading ${request.type.replace("_", " ")}.`);
    }, REQUEST_TIMEOUT_MS);
    this.lastRequestAt = Date.now();
    try {
      this.socket.send(JSON.stringify({ ...request.payload, req_id: requestId }));
    } catch (error) {
      clearTimeout(request.timeout);
      this.pending.delete(requestId);
      this.disconnect(this.socket, `Could not send market data request: ${error.message}`);
    }
    if (this.requestQueue.length) {
      if (this.requestIntervalMs === 0) this.flushRequests();
      else {
        this.requestTimer = setTimeout(() => {
          this.requestTimer = null;
          this.flushRequests();
        }, this.requestIntervalMs);
      }
    }
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.fail("Received an invalid response from Deriv's market scanner.");
      return;
    }

    const request = this.pending.get(message.req_id);
    if (message.error) {
      if (!request) {
        this.fail(String(message.error.message ?? "Deriv rejected a scanner request."));
        return;
      }
      this.finishRequest(message.req_id);
      const reason = String(message.error.message ?? "Deriv rejected a scanner request.");
      if (isTransientConnectionError(reason)) this.disconnect(this.socket, reason);
      else if (request.type === "active_symbols") this.fail(reason);
      else this.markMarketError(request.symbol, reason);
      return;
    }

    if (request?.type === "active_symbols" && message.active_symbols) {
      this.finishRequest(message.req_id);
      this.discoverMarkets(message.active_symbols);
      return;
    }
    if (request?.type === "contracts_for" && message.contracts_for) {
      this.finishRequest(message.req_id);
      this.handleContracts(request.symbol, message.contracts_for);
      return;
    }
    if (request?.type === "ticks_history" && message.history) {
      this.finishRequest(message.req_id);
      this.importHistory(request.symbol, message.history);
      return;
    }
    if (message.msg_type === "tick" && message.tick) this.addTick(message.tick);
  }

  discoverMarkets(activeSymbols) {
    if (!Array.isArray(activeSymbols)) {
      this.fail("Deriv returned an invalid active market list.");
      return;
    }
    const eligible = activeSymbols.filter((entry) =>
      typeof entry?.underlying_symbol === "string" &&
      /^\w{2,30}$/.test(entry.underlying_symbol) &&
      entry.exchange_is_open === 1 &&
      entry.is_trading_suspended !== 1 &&
      entry.is_trading_suspended !== true);
    for (const entry of eligible) {
      const symbol = entry.underlying_symbol;
      if (this.markets.has(symbol)) continue;
      this.markets.set(symbol, {
        symbol,
        name: entry.underlying_symbol_name ?? symbol,
        market: entry.market ?? "unknown",
        status: "loading_contracts",
        ticksLoaded: 0,
        lastQuote: null,
        aggregator: null,
        lastClosedTimestamp: null,
        bufferedTicks: [],
        error: null
      });
      this.sendRequest({ contracts_for: symbol }, "contracts_for", symbol);
    }
    if (!eligible.length) {
      this.fail("Deriv returned no open, unsuspended CALL/PUT markets.");
      return;
    }
    this.status = "loading_history";
    this.publish();
  }

  handleContracts(symbol, response) {
    const market = this.markets.get(symbol);
    if (!market || market.status !== "loading_contracts") return;
    const contracts = response?.available;
    if (!Array.isArray(contracts) ||
        !supportsRiseFallDuration(contracts, this.durationSeconds)) {
      market.status = "unsupported";
      market.error = `No CALL and PUT contracts available for ${this.durationSeconds}s.`;
      this.updateStatus();
      return;
    }
    market.aggregator = new TickCandleAggregator({
      symbol,
      timeframeSeconds: CANDLE_TIMEFRAME_SECONDS
    });
    market.status = "loading_history";
    this.sendRequest({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: HISTORY_TICK_COUNT,
      end: "latest",
      start: 1,
      style: "ticks",
      subscribe: 1
    }, "ticks_history", symbol);
    this.updateStatus();
  }

  importHistory(symbol, history) {
    const market = this.markets.get(symbol);
    if (!market || market.status !== "loading_history") return;
    if (!Array.isArray(history?.times) || !Array.isArray(history?.prices) ||
        history.times.length !== history.prices.length || !history.times.length) {
      this.markMarketError(symbol, "Deriv returned no usable tick history.");
      return;
    }
    const ticks = history.times.map((epoch, index) => ({
      epoch: Number(epoch),
      quote: Number(history.prices[index]),
      index
    })).sort((left, right) => left.epoch - right.epoch || left.index - right.index);
    try {
      for (const tick of ticks) market.aggregator.addTick(tick);
    } catch (error) {
      this.markMarketError(symbol, `Could not build candles from tick history: ${error.message}`);
      return;
    }
    market.ticksLoaded = ticks.length;
    market.lastQuote = ticks.at(-1).quote;
    market.lastClosedTimestamp = market.aggregator
      .getCandles({ includeCurrent: false }).at(-1)?.timestamp ?? null;
    market.status = "streaming";
    market.error = null;
    const buffered = market.bufferedTicks.splice(0)
      .sort((left, right) => Number(left.epoch) - Number(right.epoch));
    for (const tick of buffered) this.processTick(market, tick);
    this.updateStatus();
  }

  addTick(tick) {
    const market = this.markets.get(tick?.symbol);
    if (!market || ["error", "unsupported"].includes(market.status)) return;
    if (market.status !== "streaming") {
      if (market.bufferedTicks.length >= MAX_BUFFERED_TICKS) {
        this.markMarketError(market.symbol, "Too many live ticks arrived before history finished loading.");
        return;
      }
      market.bufferedTicks.push(tick);
      return;
    }
    this.processTick(market, tick);
  }

  processTick(market, tick) {
    try {
      const accepted = market.aggregator.addTick({ epoch: tick.epoch, quote: tick.quote });
      if (!accepted) return;
    } catch (error) {
      this.markMarketError(market.symbol, `Could not build a 15-second candle: ${error.message}`);
      return;
    }
    market.lastQuote = Number(tick.quote);
    const candles = market.aggregator.getCandles({ includeCurrent: false });
    const latestClosed = candles.at(-1);
    if (latestClosed && latestClosed.timestamp !== market.lastClosedTimestamp) {
      market.lastClosedTimestamp = latestClosed.timestamp;
      this.onClosedCandle({ symbol: market.symbol, candle: latestClosed, candles });
      this.publish();
    } else {
      this.onUpdate(this.getSnapshot());
    }
  }

  markMarketError(symbol, error) {
    const market = this.markets.get(symbol);
    if (!market) {
      this.fail(error);
      return;
    }
    market.status = "error";
    market.error = error;
    market.bufferedTicks.length = 0;
    this.updateStatus();
  }

  finishRequest(requestId) {
    const request = this.pending.get(requestId);
    if (!request) return null;
    clearTimeout(request.timeout);
    this.pending.delete(requestId);
    return request;
  }

  clearPending() {
    if (this.requestTimer !== null) clearTimeout(this.requestTimer);
    this.requestTimer = null;
    this.requestQueue.length = 0;
    for (const request of this.pending.values()) {
      if (request.timeout !== null) clearTimeout(request.timeout);
    }
    this.pending.clear();
  }

  updateStatus() {
    const snapshot = this.getSnapshot();
    if (snapshot.pendingCount > 0) {
      this.status = "loading_history";
      this.error = null;
    } else if (snapshot.ready) {
      this.status = "streaming";
      this.error = null;
    } else {
      this.status = "error";
      const firstMarketError = [...this.markets.values()].find((market) => market.error)?.error;
      this.error = snapshot.errorCount
        ? `${snapshot.errorCount} market request(s) failed; scanner is incomplete.${firstMarketError ? ` First error: ${firstMarketError}` : ""}`
        : "No open market supports the selected Rise/Fall expiry.";
    }
    if (this.status === "streaming" && this.stabilityTimer === null) {
      this.stabilityTimer = setTimeout(() => {
        if (this.status === "streaming") this.attempt = 0;
        this.stabilityTimer = null;
      }, STABLE_CONNECTION_MS);
    } else if (this.status !== "streaming" && this.stabilityTimer !== null) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    this.publish();
  }

  scheduleReconnect(error) {
    if (this.stopped || this.retryTimer !== null) return;
    this.status = "reconnecting";
    this.error = error;
    this.clearConnectionTimers();
    this.publish();
    const delay = Math.min(30000, 1000 * (2 ** Math.min(this.attempt, 5)));
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.clearPending();
      this.markets.clear();
      this.connect();
    }, delay);
  }

  fail(error) {
    this.stopped = true;
    this.clearConnectionTimers();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearPending();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close();
    this.status = "error";
    this.error = error;
    this.publish();
  }

  publish() {
    this.onUpdate(this.getSnapshot());
  }
}
