import { candleGeometry } from "../data/candle-model.js";

export function equalLiquidityLevels(swings, candles, index, { tickSize = 0, atr = 0 } = {}) {
  const tolerance = Math.max(tickSize, 0.05 * atr);
  const earliestTimestamp = candles[Math.max(0, index - 49)]?.timestamp ?? 0;
  const levels = [];
  for (const type of ["high", "low"]) {
    const points = swings.filter((swing) =>
      swing.type === type && swing.pivotTimestamp >= earliestTimestamp &&
      swing.confirmationIndex <= index);
    for (let right = 1; right < points.length; right += 1) {
      for (let left = 0; left < right; left += 1) {
        const first = points[left];
        const second = points[right];
        if (Math.abs(first.pivotPrice - second.pivotPrice) > tolerance) continue;
        const price = (first.pivotPrice + second.pivotPrice) / 2;
        if (levels.some((level) => level.type === type &&
          Math.abs(level.price - price) <= tolerance)) continue;
        levels.push({
          type: type === "high" ? "equal-highs" : "equal-lows",
          price,
          fromTimestamp: Math.min(first.pivotTimestamp, second.pivotTimestamp),
          throughTimestamp: candles[index]?.timestamp ?? second.confirmationTimestamp,
          pivotTimestamps: [first.pivotTimestamp, second.pivotTimestamp]
        });
      }
    }
  }
  return levels;
}

export function detectLiquiditySweep(candle, priorSwing, atr, tickSize = 0) {
  if (!candle?.isClosed || !priorSwing || !Number.isFinite(atr) || atr <= 0) return null;
  const tolerance = Math.max(tickSize, 0.05 * atr);
  const geometry = candleGeometry(candle);
  if (geometry.closeLocation === null) return null;
  if (priorSwing.type === "low" &&
      candle.low < priorSwing.pivotPrice - tolerance &&
      candle.close > priorSwing.pivotPrice &&
      candle.close > candle.open &&
      geometry.closeLocation >= 0.6 &&
      geometry.range >= 0.5 * atr) {
    return {
      type: "bullish-sweep",
      level: priorSwing.pivotPrice,
      penetrationExtreme: candle.low,
      reclaimCandleTimestamp: candle.timestamp,
      confirmationTimestamp: candle.timestamp + candle.timeframeSeconds * 1000,
      associatedSwing: priorSwing,
      status: "CONFIRMED"
    };
  }
  if (priorSwing.type === "high" &&
      candle.high > priorSwing.pivotPrice + tolerance &&
      candle.close < priorSwing.pivotPrice &&
      candle.close < candle.open &&
      geometry.closeLocation <= 0.4 &&
      geometry.range >= 0.5 * atr) {
    return {
      type: "bearish-sweep",
      level: priorSwing.pivotPrice,
      penetrationExtreme: candle.high,
      reclaimCandleTimestamp: candle.timestamp,
      confirmationTimestamp: candle.timestamp + candle.timeframeSeconds * 1000,
      associatedSwing: priorSwing,
      status: "CONFIRMED"
    };
  }
  return null;
}
