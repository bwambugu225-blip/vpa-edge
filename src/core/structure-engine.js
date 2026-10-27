import { classifySwing, findConfirmedSwings } from "./swing-engine.js";
import { atrSeries } from "./indicators.js";

export function analyzeStructure(candles, options = {}) {
  const swings = findConfirmedSwings(candles, options);
  const atr = atrSeries(candles, options.atrPeriod ?? 14);
  const highs = [];
  const lows = [];
  const classified = swings.map((swing) => {
    const tolerance = Math.max(options.tickSize ?? 0, 0.05 * (atr[swing.confirmationIndex] ?? 0));
    const list = swing.type === "high" ? highs : lows;
    const classification = classifySwing(swing, list.at(-1), tolerance);
    list.push({ ...swing, classification });
    return { ...swing, classification, tolerance };
  });
  const recentHighs = highs.slice(-2);
  const recentLows = lows.slice(-2);
  const latestHighClass = recentHighs.at(-1)?.classification;
  const latestLowClass = recentLows.at(-1)?.classification;
  const bullish = latestHighClass === "HH" && latestLowClass === "HL";
  const bearish = latestHighClass === "LH" && latestLowClass === "LL";
  const bias = bullish === bearish ? "neutral" : bullish ? "bullish" : "bearish";
  return { swings: classified, highs, lows, bias, recentHighs, recentLows, atr };
}
