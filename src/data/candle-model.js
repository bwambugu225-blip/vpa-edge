const REQUIRED = ["timestamp", "open", "high", "low", "close", "symbol", "timeframeSeconds"];

export function normalizeCandle(input) {
  if (!input || typeof input !== "object") throw new TypeError("Candle must be an object");
  for (const key of REQUIRED) {
    if (!(key in input)) throw new TypeError(`Missing candle field: ${key}`);
  }
  const timestamp = Number(input.timestamp);
  const timeframeSeconds = Number(input.timeframeSeconds);
  const candle = {
    timestamp,
    open: Number(input.open),
    high: Number(input.high),
    low: Number(input.low),
    close: Number(input.close),
    volume: input.volume === null || input.volume === undefined || input.volume === ""
      ? null : Number(input.volume),
    isClosed: input.isClosed === true,
    symbol: String(input.symbol).trim(),
    timeframeSeconds,
    volumeType: input.volumeType ?? "unknown"
  };

  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError("Invalid UTC timestamp");
  for (const key of ["open", "high", "low", "close"]) {
    if (!Number.isFinite(candle[key])) throw new TypeError(`${key} must be finite`);
  }
  if (candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low) throw new RangeError("Invalid OHLC range");
  if (candle.volume !== null && (!Number.isFinite(candle.volume) || candle.volume < 0)) {
    throw new RangeError("Volume must be null or a nonnegative finite number");
  }
  if (!candle.symbol) throw new TypeError("Symbol must not be empty");
  if (!Number.isSafeInteger(timeframeSeconds) || timeframeSeconds <= 0) {
    throw new RangeError("timeframeSeconds must be a positive integer");
  }
  if (!["tick", "exchange", "unknown"].includes(candle.volumeType)) {
    throw new TypeError("Invalid volumeType");
  }
  return Object.freeze(candle);
}

export function candleKey(candle) {
  return JSON.stringify([candle.symbol, candle.timeframeSeconds, candle.timestamp]);
}

export function normalizeCandleSeries(inputs, { deduplicate = true } = {}) {
  if (!Array.isArray(inputs)) throw new TypeError("Candle series must be an array");
  const byTimestamp = new Map();
  let identity = null;
  for (const input of inputs) {
    const candle = normalizeCandle(input);
    const currentIdentity = `${candle.symbol}|${candle.timeframeSeconds}`;
    if (identity !== null && identity !== currentIdentity) {
      throw new RangeError("Candle series must use one symbol and timeframe");
    }
    identity = currentIdentity;
    const prior = byTimestamp.get(candle.timestamp);
    if (prior && !deduplicate) throw new RangeError("Duplicate candle timestamp");
    if (!prior || candle.isClosed || !prior.isClosed) byTimestamp.set(candle.timestamp, candle);
  }
  const ordered = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].timestamp - ordered[index - 1].timestamp;
    if (gap % (ordered[index].timeframeSeconds * 1000) !== 0) {
      throw new RangeError(`Candle timestamp gap is not timeframe-aligned at ${ordered[index].timestamp}`);
    }
  }
  return ordered;
}

export function validateCandleSeries(inputs, options) {
  if (!Array.isArray(inputs)) throw new TypeError("Candle series must be an array");
  const timestamps = inputs.map((item) => Number(item?.timestamp));
  const seen = new Set();
  const duplicateTimestamps = new Set();
  for (const timestamp of timestamps) {
    if (seen.has(timestamp)) duplicateTimestamps.add(timestamp);
    seen.add(timestamp);
  }
  const outOfOrder = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] < timestamps[index - 1]) {
      outOfOrder.push({ previousTimestamp: timestamps[index - 1], timestamp: timestamps[index] });
    }
  }
  const candles = normalizeCandleSeries(inputs, options);
  const gaps = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const expected = previous.timestamp + previous.timeframeSeconds * 1000;
    if (current.timestamp > expected) {
      gaps.push({
        fromTimestamp: previous.timestamp,
        toTimestamp: current.timestamp,
        missingIntervals: Math.floor(
          (current.timestamp - previous.timestamp) / (current.timeframeSeconds * 1000)
        ) - 1
      });
    }
  }
  return { candles, gaps, duplicateTimestamps: [...duplicateTimestamps], outOfOrder };
}

export function candleGeometry(candle) {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (range === 0) {
    return {
      range, body, bodyRatio: null, upperWick: 0, lowerWick: 0,
      upperWickRatio: null, lowerWickRatio: null, closeLocation: null
    };
  }
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  return {
    range,
    body,
    bodyRatio: body / range,
    upperWick,
    lowerWick,
    upperWickRatio: upperWick / range,
    lowerWickRatio: lowerWick / range,
    closeLocation: (candle.close - candle.low) / range
  };
}
