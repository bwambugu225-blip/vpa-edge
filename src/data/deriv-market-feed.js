import { TickCandleAggregator } from "./tick-candle-aggregator.js";

export const DERIV_PUBLIC_WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
export const DERIV_API_BASE_URL = "https://api.derivws.com";
export const HISTORY_TICK_COUNT = 500;
export const CANDLE_TIMEFRAME_SECONDS = 15;

export class DerivMarketFeed {
  constructor({
    WebSocketImpl = globalThis.WebSocket,
    onUpdate = () => {},
    onClosedCandle = () => {}
  } = {}) {
    if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is unavailable");
    this.WebSocketImpl = WebSocketImpl;
    this.onUpdate = onUpdate;
    this.onClosedCandle = onClosedCandle;
    this.socket = null;
    this.retryTimer = null;
    this.stopped = true;
    this.attempt = 0;
    this.symbol = null;
    this.aggregator = null;
    this.ticksLoaded = 0;
    this.lastQuote = null;
    this.status = "disconnected";
  }

  start(symbol) {
    if (typeof symbol !== "string" || !/^\w{2,30}$/.test(symbol)) {
      throw new TypeError("Enter a valid Deriv underlying symbol");
    }
    this.stop();
    this.symbol = symbol;
    this.stopped = false;
    this.attempt = 0;
    this.lastClosedTimestamp = null;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close();
    this.status = "disconnected";
  }

  getSnapshot() {
    return {
      status: this.status,
      symbol: this.symbol,
      timeframeSeconds: CANDLE_TIMEFRAME_SECONDS,
      ticksLoaded: this.ticksLoaded,
      lastQuote: this.lastQuote,
      candles: this.aggregator?.getCandles() ?? []
    };
  }

  connect() {
    if (this.stopped) return;
    this.status = this.attempt ? "reconnecting" : "connecting";
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
      this.attempt = 0;
      this.aggregator = new TickCandleAggregator({
        symbol: this.symbol,
        timeframeSeconds: CANDLE_TIMEFRAME_SECONDS
      });
      this.lastClosedTimestamp = null;
      this.ticksLoaded = 0;
      this.lastQuote = null;
      this.status = "loading_history";
      this.publish();
      socket.send(JSON.stringify({
        ticks_history: this.symbol,
        adjust_start_time: 1,
        count: HISTORY_TICK_COUNT,
        end: "latest",
        start: 1,
        style: "ticks",
        subscribe: 1
      }));
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      if (socket === this.socket && !this.stopped) {
        this.status = "reconnecting";
        this.publish({ error: "Market data connection interrupted; reconnecting." });
      }
    };
    socket.onclose = () => {
      if (socket === this.socket && !this.stopped) {
        this.socket = null;
        this.scheduleReconnect("Market data connection closed; reconnecting.");
      }
    };
  }

  scheduleReconnect(error) {
    if (this.stopped || this.retryTimer !== null) return;
    this.status = "reconnecting";
    this.publish({ error });
    const delay = Math.min(30000, 1000 * (2 ** Math.min(this.attempt, 5)));
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.fail("Received an invalid response from Deriv.");
      return;
    }
    if (message.error) {
      this.fail(String(message.error.message ?? "Deriv rejected the market-data request."));
      return;
    }

    if (message.msg_type === "history" || message.history) {
      this.importHistory(message.history);
      return;
    }
    if (message.msg_type === "tick" && message.tick) this.addTick(message.tick);
  }

  importHistory(history) {
    if (!Array.isArray(history?.times) || !Array.isArray(history?.prices) ||
        history.times.length !== history.prices.length || !history.times.length) {
      this.fail("Deriv returned no usable tick history.");
      return;
    }
    const ticks = history.times.map((epoch, index) => ({
      epoch: Number(epoch),
      quote: Number(history.prices[index]),
      index
    })).sort((left, right) => left.epoch - right.epoch || left.index - right.index);
    try {
      for (const tick of ticks) this.aggregator.addTick(tick);
    } catch (error) {
      this.fail(`Could not build candles from tick history: ${error.message}`);
      return;
    }
    this.ticksLoaded = ticks.length;
    this.lastQuote = ticks.at(-1).quote;
    this.lastClosedTimestamp = this.aggregator
      .getCandles({ includeCurrent: false }).at(-1)?.timestamp ?? null;
    this.status = "streaming";
    this.publish();
  }

  addTick(tick) {
    if (tick.symbol && tick.symbol !== this.symbol) return;
    try {
      const accepted = this.aggregator.addTick({ epoch: tick.epoch, quote: tick.quote });
      if (!accepted) return;
    } catch (error) {
      this.fail(`Could not build a 15-second candle: ${error.message}`);
      return;
    }
    this.lastQuote = Number(tick.quote);
    const closedCandles = this.aggregator.getCandles({ includeCurrent: false });
    const latestClosed = closedCandles.at(-1);
    if (latestClosed && latestClosed.timestamp !== this.lastClosedTimestamp) {
      this.lastClosedTimestamp = latestClosed.timestamp;
      this.onClosedCandle(latestClosed, closedCandles);
      this.publish();
    } else {
      this.onUpdate(this.getSnapshot());
    }
  }

  fail(error) {
    this.stopped = true;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close();
    this.status = "error";
    this.publish({ error });
  }

  publish(extra = {}) {
    this.onUpdate({ ...this.getSnapshot(), ...extra });
  }
}
