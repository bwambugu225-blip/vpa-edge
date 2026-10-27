export function calculateTarget({
  direction, entryReference, atr, swings, timestamp, timeframeSeconds,
  multiplier = 1, horizonCandles = 3
}) {
  if (!["bullish", "bearish"].includes(direction)) throw new TypeError("Invalid target direction");
  if (!Number.isFinite(entryReference) || !Number.isFinite(atr) || atr <= 0) {
    return { available: false, reason: "A finite entry reference and positive ATR are required" };
  }
  if (!Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 3) {
    throw new RangeError("ATR multiplier must be from 0.5 through 3.0");
  }
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(timeframeSeconds) ||
      timeframeSeconds <= 0 || !Number.isInteger(horizonCandles) || horizonCandles <= 0) {
    throw new RangeError("Target time and forecast horizon must be valid positive candle values");
  }
  const isAbove = direction === "bullish";
  const candidates = swings.filter((swing) =>
    (isAbove ? swing.type === "high" && swing.pivotPrice > entryReference
      : swing.type === "low" && swing.pivotPrice < entryReference))
    .sort((a, b) => isAbove
      ? a.pivotPrice - b.pivotPrice : b.pivotPrice - a.pivotPrice);
  const structural = candidates[0];
  const fallback = entryReference + (isAbove ? 1 : -1) * atr * multiplier;
  const meaningfulStructural = structural &&
    Math.abs(structural.pivotPrice - entryReference) >= atr * 0.25;
  return {
    available: true,
    targetPrice: meaningfulStructural ? structural.pivotPrice : fallback,
    method: meaningfulStructural ? "nearest-structure" : "atr-fallback",
    sourceLevel: meaningfulStructural ? structural : null,
    signalTimestamp: timestamp,
    signalPrice: entryReference,
    targetTimestamp: timestamp + timeframeSeconds * 1000 * horizonCandles,
    direction,
    forecastHorizonCandles: horizonCandles,
    calculation: meaningfulStructural
      ? `Nearest confirmed ${direction === "bullish" ? "swing high" : "swing low"}`
      : `${multiplier} x ATR(${atr}) from entry reference`
  };
}
