export function findConfirmedSwings(candles, { leftBars = 3, rightBars = 2 } = {}) {
  const result = [];
  for (let pivotIndex = leftBars; pivotIndex + rightBars < candles.length; pivotIndex += 1) {
    const prior = candles.slice(pivotIndex - leftBars, pivotIndex);
    const later = candles.slice(pivotIndex + 1, pivotIndex + rightBars + 1);
    const pivot = candles[pivotIndex];
    const swingHigh = prior.every((candle) => pivot.high > candle.high) &&
      later.every((candle) => pivot.high >= candle.high);
    const swingLow = prior.every((candle) => pivot.low < candle.low) &&
      later.every((candle) => pivot.low <= candle.low);
    if (swingHigh) result.push({
      pivotTimestamp: pivot.timestamp, pivotPrice: pivot.high, pivotIndex,
      confirmationTimestamp: candles[pivotIndex + rightBars].timestamp,
      confirmationIndex: pivotIndex + rightBars, type: "high"
    });
    if (swingLow) result.push({
      pivotTimestamp: pivot.timestamp, pivotPrice: pivot.low, pivotIndex,
      confirmationTimestamp: candles[pivotIndex + rightBars].timestamp,
      confirmationIndex: pivotIndex + rightBars, type: "low"
    });
  }
  return result.sort((a, b) => a.confirmationIndex - b.confirmationIndex || a.pivotIndex - b.pivotIndex);
}

export function classifySwing(swing, previous, tolerance = 0) {
  if (!previous) return "initial";
  const difference = swing.pivotPrice - previous.pivotPrice;
  if (Math.abs(difference) <= tolerance) return swing.type === "high" ? "EQH" : "EQL";
  if (swing.type === "high") return difference > 0 ? "HH" : "LH";
  return difference > 0 ? "HL" : "LL";
}
