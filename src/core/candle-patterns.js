import { candleGeometry } from "../data/candle-model.js";

export function candlePatterns(previous, current) {
  const geometry = candleGeometry(current);
  const bullishEngulfing = Boolean(previous &&
    previous.close < previous.open &&
    current.close > current.open &&
    current.open <= previous.close &&
    current.close >= previous.open &&
    geometry.bodyRatio >= 0.5);
  const bearishEngulfing = Boolean(previous &&
    previous.close > previous.open &&
    current.close < current.open &&
    current.open >= previous.close &&
    current.close <= previous.open &&
    geometry.bodyRatio >= 0.5);
  return {
    bullishEngulfing,
    bearishEngulfing,
    bullishRejection: geometry.lowerWickRatio !== null &&
      geometry.lowerWickRatio >= 0.5 && geometry.bodyRatio <= 0.4 &&
      geometry.closeLocation >= 0.65,
    bearishRejection: geometry.upperWickRatio !== null &&
      geometry.upperWickRatio >= 0.5 && geometry.bodyRatio <= 0.4 &&
      geometry.closeLocation <= 0.35
  };
}
