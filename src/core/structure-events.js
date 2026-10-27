import { analyzeStructure } from "./structure-engine.js";

export function detectStructureEvents(priorCandles, current, { tickSize = 0 } = {}) {
  if (!current?.isClosed || priorCandles.length === 0) return [];
  const structure = analyzeStructure(priorCandles);
  const last = priorCandles.at(-1);
  const atr = structure.atr?.at(-1) ?? 0;
  const tolerance = Math.max(tickSize, 0.05 * atr);
  const events = [];
  const lastHigh = structure.highs.at(-1);
  const lastLow = structure.lows.at(-1);
  if (lastHigh && last.close <= lastHigh.pivotPrice + tolerance &&
      current.close > lastHigh.pivotPrice + tolerance) {
    events.push({
      type: "bullish-BOS",
      brokenLevel: lastHigh.pivotPrice,
      confirmationTimestamp: current.timestamp + current.timeframeSeconds * 1000,
      confirmationCandleTimestamp: current.timestamp,
      previousBias: structure.bias
    });
  }
  if (lastLow && last.close >= lastLow.pivotPrice - tolerance &&
      current.close < lastLow.pivotPrice - tolerance) {
    events.push({
      type: "bearish-BOS",
      brokenLevel: lastLow.pivotPrice,
      confirmationTimestamp: current.timestamp + current.timeframeSeconds * 1000,
      confirmationCandleTimestamp: current.timestamp,
      previousBias: structure.bias
    });
  }
  const relevantLowerHigh = [...structure.highs].reverse()
    .find((swing) => swing.classification === "LH");
  const relevantHigherLow = [...structure.lows].reverse()
    .find((swing) => swing.classification === "HL");
  if (structure.bias === "bearish" && relevantLowerHigh &&
      last.close <= relevantLowerHigh.pivotPrice + tolerance &&
      current.close > relevantLowerHigh.pivotPrice + tolerance) {
    events.push({
      type: "bullish-CHoCH", brokenLevel: relevantLowerHigh.pivotPrice,
      confirmationTimestamp: current.timestamp + current.timeframeSeconds * 1000,
      confirmationCandleTimestamp: current.timestamp,
      previousBias: structure.bias
    });
  }
  if (structure.bias === "bullish" && relevantHigherLow &&
      last.close >= relevantHigherLow.pivotPrice - tolerance &&
      current.close < relevantHigherLow.pivotPrice - tolerance) {
    events.push({
      type: "bearish-CHoCH", brokenLevel: relevantHigherLow.pivotPrice,
      confirmationTimestamp: current.timestamp + current.timeframeSeconds * 1000,
      confirmationCandleTimestamp: current.timestamp,
      previousBias: structure.bias
    });
  }
  return events;
}
