import { candleGeometry } from "../data/candle-model.js";

const LOOKBACK = 20;

function isBullish(candle) {
  return candle.close > candle.open;
}

function isBearish(candle) {
  return candle.close < candle.open;
}

function addRule(rules, id, direction, description) {
  rules.push({ id, direction, description });
}

export function analyzeVpa(candles, { lookback = LOOKBACK } = {}) {
  if (!Array.isArray(candles)) throw new TypeError("Candles must be an array");
  if (!Number.isSafeInteger(lookback) || lookback < 2) {
    throw new RangeError("lookback must be an integer of at least two");
  }

  const completed = candles.filter((candle) => candle.isClosed);
  const current = completed.at(-1);
  if (!current) {
    return {
      direction: "neutral",
      rules: [],
      checklist: {},
      ready: false,
      reason: "Waiting for a completed 5-second candle."
    };
  }

  const previous = completed.slice(0, -1).slice(-lookback);
  const requiredHistory = Math.min(lookback, 10);
  const geometry = candleGeometry(current);
  const historicalRanges = previous.map((candle) => candle.high - candle.low);
  const averageRange = historicalRanges.length
    ? historicalRanges.reduce((sum, range) => sum + range, 0) / historicalRanges.length
    : null;
  const knownVolumes = previous.map((candle) => candle.volume);
  const volumeBaselineAvailable = knownVolumes.length > 0 &&
    knownVolumes.every((volume) => Number.isFinite(volume));
  const averageVolume = volumeBaselineAvailable
    ? knownVolumes.reduce((sum, volume) => sum + volume, 0) / knownVolumes.length
    : null;
  const relativeVolume = current.volume !== null && averageVolume > 0
    ? current.volume / averageVolume
    : null;
  const rangeRatio = averageRange > 0 ? geometry.range / averageRange : null;
  const ready = previous.length >= requiredHistory &&
    relativeVolume !== null && rangeRatio !== null;

  if (!ready) {
    return {
      direction: "neutral",
      rules: [],
      checklist: {
        volumeIncreasing: relativeVolume === null ? null : relativeVolume > 1,
        effortMatchesResult: null,
        unusualVolume: relativeVolume === null ? null : relativeVolume >= 1.5,
        volumeDivergence: false
      },
      ready: false,
      reason: `Collecting history: ${previous.length}/${requiredHistory} completed candles for the VPA baseline.`,
      candle: current,
      relativeVolume,
      rangeRatio,
      volumeType: current.volumeType
    };
  }

  const priorHighCandle = previous.reduce((highest, candle) =>
    candle.high > highest.high ? candle : highest, previous[0]);
  const priorHigh = priorHighCandle.high;
  const priorLow = Math.min(...previous.map((candle) => candle.low));
  const keyLevelTolerance = averageRange * 0.2;
  const nearResistance = current.high >= priorHigh - keyLevelTolerance;
  const nearSupport = current.low <= priorLow + keyLevelTolerance;
  const risingTrend = previous.length >= 5 &&
    previous.at(-1).close > previous[Math.max(0, previous.length - 5)].close;
  const newHigh = current.high > priorHigh;
  const volumeDivergence = newHigh && current.volume < priorHighCandle.volume;
  const rules = [];

  if (relativeVolume >= 1.5 && geometry.bodyRatio !== null &&
      geometry.bodyRatio <= 0.25 && nearSupport !== nearResistance) {
    addRule(
      rules,
      "ABSORPTION_TRAP",
      nearSupport ? "bullish" : "bearish",
      `High tick activity with a small body at ${nearSupport ? "support" : "resistance"} suggests absorption.`
    );
  }

  if (relativeVolume >= 2 && isBullish(current) && risingTrend && nearResistance) {
    addRule(
      rules,
      "EXTREME_VOLUME_WARNING",
      "bearish",
      "Extreme activity on an up candle after a rising run near resistance warns of possible unloading."
    );
  }

  if (isBearish(current) && rangeRatio >= 1.4 && relativeVolume >= 2 &&
      geometry.closeLocation >= 0.5) {
    addRule(
      rules,
      "STOPPING_VOLUME",
      "bullish",
      "A wide down candle with extreme activity closing in its upper half suggests stopping demand."
    );
  }

  if (isBearish(current) && rangeRatio >= 1.4 && relativeVolume >= 1.5 &&
      geometry.closeLocation >= 0.35 && geometry.closeLocation <= 0.65) {
    addRule(
      rules,
      "SELLING_CLIMAX",
      "bullish",
      "A wide bearish candle with excessive activity and a long lower wick signals capitulation."
    );
  }

  if (volumeDivergence) {
    addRule(
      rules,
      "VOLUME_DIVERGENCE",
      "bearish",
      "Price made a new lookback high on fewer ticks than the previous high."
    );
  }

  if (isBullish(current) && geometry.lowerWickRatio >= 0.5 &&
      geometry.closeLocation >= 0.65 && relativeVolume >= 1.5) {
    addRule(
      rules,
      "HIGH_VOLUME_PIN_BAR",
      "bullish",
      "A high-activity bullish candle rejected lower prices with a long lower wick."
    );
  }

  if (isBearish(current) && rangeRatio >= 1.5 && relativeVolume >= 2 &&
      geometry.lowerWickRatio >= 0.4) {
    addRule(
      rules,
      "SELLING_CLIMAX",
      "bullish",
      "A wide, high-activity down candle with a long lower wick suggests a possible selling climax."
    );
  }

  if (isBearish(current) && rangeRatio >= 1.3 && relativeVolume <= 0.75) {
    addRule(
      rules,
      "BEARISH_EFFORT_LOWER_THAN_RESULT",
      "bullish",
      "A larger down move on below-average tick activity suggests seller exhaustion."
    );
  }

  if (isBearish(current) && relativeVolume >= 1.5 &&
      (rangeRatio <= 0.75 || geometry.bodyRatio <= 0.35)) {
    addRule(
      rules,
      "BEARISH_EFFORT_HIGHER_THAN_RESULT",
      "bullish",
      "High activity produced little downward progress, suggesting buyers may be absorbing supply."
    );
  }

  if (isBearish(current) && rangeRatio <= 0.65 && relativeVolume <= 0.7) {
    addRule(
      rules,
      "NO_SUPPLY",
      "bullish",
      "A narrow down candle on low activity suggests limited selling pressure."
    );
  }

  const bullishCount = rules.filter((rule) => rule.direction === "bullish").length;
  const bearishCount = rules.length - bullishCount;
  const direction = bullishCount === bearishCount
    ? "neutral"
    : bullishCount > bearishCount ? "bullish" : "bearish";

  return {
    direction,
    rules,
    bullishCount,
    bearishCount,
    ready: true,
    reason: rules.length ? null : "No VPA pattern matched the completed candle.",
    candle: current,
    relativeVolume,
    rangeRatio,
    volumeType: current.volumeType,
    keyLevels: { support: priorLow, resistance: priorHigh },
    nearSupport,
    nearResistance,
    checklist: {
      volumeIncreasing: relativeVolume > 1,
      effortMatchesResult: (relativeVolume >= 1) === (rangeRatio >= 1),
      unusualVolume: relativeVolume >= 1.5,
      volumeDivergence
    }
  };
}
