const DEFAULT_TIMEFRAME_SECONDS = 5;

export class TickCandleAggregator {
  constructor({ symbol, timeframeSeconds = DEFAULT_TIMEFRAME_SECONDS, maxCandles = 500 }) {
    if (typeof symbol !== "string" || !/^\w{2,30}$/.test(symbol)) {
      throw new TypeError("Symbol must contain 2 to 30 letters, numbers, or underscores");
    }
    if (!Number.isSafeInteger(timeframeSeconds) || timeframeSeconds <= 0) {
      throw new RangeError("timeframeSeconds must be a positive integer");
    }
    if (!Number.isSafeInteger(maxCandles) || maxCandles <= 0) {
      throw new RangeError("maxCandles must be a positive integer");
    }
    this.symbol = symbol;
    this.timeframeSeconds = timeframeSeconds;
    this.maxCandles = maxCandles;
    this.closedCandles = [];
    this.current = null;
  }

  addTick({ epoch, quote }) {
    const timestamp = Number(epoch);
    const price = Number(quote);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("Tick epoch must be a nonnegative integer in seconds");
    }
    if (!Number.isFinite(price)) throw new TypeError("Tick quote must be finite");

    const bucket = Math.floor(timestamp / this.timeframeSeconds) * this.timeframeSeconds;
    if (this.current && bucket < this.current.timestamp / 1000) return false;
    if (this.current && bucket > this.current.timestamp / 1000) this.closeCurrent();

    if (!this.current) {
      const timestampMs = bucket * 1000;
      this.current = {
        timestamp: timestampMs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
        isClosed: false,
        symbol: this.symbol,
        timeframeSeconds: this.timeframeSeconds,
        volumeType: "tick"
      };
      return true;
    }

    this.current.high = Math.max(this.current.high, price);
    this.current.low = Math.min(this.current.low, price);
    this.current.close = price;
    this.current.volume += 1;
    return true;
  }

  closeCurrent() {
    if (!this.current) return null;
    const candle = Object.freeze({ ...this.current, isClosed: true });
    this.closedCandles.push(candle);
    if (this.closedCandles.length > this.maxCandles) this.closedCandles.shift();
    this.current = null;
    return candle;
  }

  getCandles({ includeCurrent = true } = {}) {
    return includeCurrent && this.current
      ? [...this.closedCandles, Object.freeze({ ...this.current })]
      : [...this.closedCandles];
  }
}
