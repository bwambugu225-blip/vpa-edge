import { candleGeometry } from "../data/candle-model.js";
import { indicatorSeries } from "./indicators.js";
import { candlePatterns } from "./candle-patterns.js";
import { detectLiquiditySweep } from "./liquidity-engine.js";
import { detectStructureEvents } from "./structure-events.js";
import { analyzeStructure } from "./structure-engine.js";
import { calculateTarget } from "./target-engine.js";

export const STRATEGY_VERSION = "1.0.0";

export function scoreDirection(direction, { bias, bos, choch, sweep, patterns, candle, geometry,
  volume, ema9, ema21, emaSlope, regime, setupType }) {
  const bullish = direction === "bullish";
  const directionalBreak = (bullish ? bos?.type === "bullish-BOS" : bos?.type === "bearish-BOS") ||
    (bullish ? choch?.type === "bullish-CHoCH" : choch?.type === "bearish-CHoCH");
  const directionalSweep = sweep?.type === `${direction}-sweep`;
  const directionalBos = bos?.type === `${direction}-BOS`;
  const structure = bias === direction ? (directionalBreak ? 25 : 18)
    : bias === "neutral" ? 10 : 0;
  const liquidity = directionalSweep ? 25 : directionalBos ? 12 : 0;
  const patternPoints = 10 * Number(bullish
    ? patterns.bullishEngulfing : patterns.bearishEngulfing) +
    10 * Number(bullish
      ? patterns.bullishRejection : patterns.bearishRejection);
  const directionalCandle = bullish
    ? candle.close > candle.open && geometry.bodyRatio >= 0.5 && geometry.closeLocation >= 0.7
    : candle.close < candle.open && geometry.bodyRatio >= 0.5 && geometry.closeLocation <= 0.3;
  const weakDirectionalProgress = bullish
    ? candle.close > candle.open
    : candle.close < candle.open;
  const volumePoints = volume.relativeVolume === null ? null
    : volume.relativeVolume >= 1.3
      ? directionalCandle ? 15 : weakDirectionalProgress ? 8 : 0
      : 0;
  const aligned = ema9 !== null && ema21 !== null && (bullish ? ema9 > ema21 : ema9 < ema21);
  const momentum = aligned
    ? emaSlope !== null && (bullish ? emaSlope > 0 : emaSlope < 0) ? 10
      : emaSlope === 0 ? 5 : 0
    : 0;
  const regimePoints = regime === "neutral" ||
    (regime === "ranging" && setupType !== "LIQUIDITY_REVERSAL") ? 2
    : regime === direction || (setupType === "LIQUIDITY_REVERSAL" && regime === "ranging") ? 5 : 0;
  const components = {
    structure: { points: structure, maximum: 25 },
    liquidity: { points: liquidity, maximum: 25 },
    priceAction: { points: Math.min(20, patternPoints), maximum: 20 },
    volume: { points: volumePoints, maximum: volumePoints === null ? null : 15 },
    momentum: { points: momentum, maximum: 10 },
    regime: { points: regimePoints, maximum: 5 }
  };
  const availableMaximum = Object.values(components)
    .reduce((sum, item) => sum + (item.maximum ?? 0), 0);
  const points = Object.values(components).reduce((sum, item) => sum + (item.points ?? 0), 0);
  return {
    normalizedScore: availableMaximum ? 100 * points / availableMaximum : 0,
    points,
    availableMaximum,
    components
  };
}

function makeCandidate(direction, sweep, bos, geometry, atr) {
  if (sweep?.type === `${direction}-sweep`) return "LIQUIDITY_REVERSAL";
  const matchingBos = bos?.type === `${direction}-BOS`;
  if (matchingBos && geometry.bodyRatio >= 0.55 && geometry.range >= 0.8 * atr) {
    return "STRUCTURAL_BREAKOUT";
  }
  return null;
}

export function evaluateSignalAt(candles, index, options = {}) {
  const current = candles[index];
  if (!current) throw new RangeError("Signal candle index is out of range");
  if (!current.isClosed) return { signals: [], rejections: ["CANDLE_INCOMPLETE"] };
  const prior = candles.slice(0, index).filter((candle) => candle.isClosed);
  const completed = [...prior, current];
  const indicators = indicatorSeries(completed, options.indicators).at(-1);
  const structure = analyzeStructure(prior, options);
  const knownSwings = structure.swings.filter((swing) => swing.confirmationIndex < prior.length);
  const lastKnownHigh = structure.highs.at(-1);
  const lastKnownLow = structure.lows.at(-1);
  const eventList = detectStructureEvents(prior, current, options);
  const bullishBos = eventList.find((event) => event.type === "bullish-BOS");
  const bearishBos = eventList.find((event) => event.type === "bearish-BOS");
  const bullishChoch = eventList.find((event) => event.type === "bullish-CHoCH");
  const bearishChoch = eventList.find((event) => event.type === "bearish-CHoCH");
  const atr = indicators?.atr;
  const patterns = candlePatterns(prior.at(-1), current);
  const geometry = candleGeometry(current);
  const sweep = atr ? detectLiquiditySweep(
    current,
    candleDirection(current) === "bullish" ? lastKnownLow : lastKnownHigh,
    atr,
    options.tickSize ?? 0
  ) : null;
  const activeBos = bullishBos ?? bearishBos;
  const volume = indicators?.relativeVolume ?? { relativeVolume: null, category: "unavailable" };
  const emaSlope = indicators?.emaSlope ?? null;
  const regime = options.regime ?? "neutral";
  const scores = {};
  const signalCandidates = [];
  const hardRejections = [];
  const rejections = [];

  for (const direction of ["bullish", "bearish"]) {
    const choch = direction === "bullish" ? bullishChoch : bearishChoch;
    const setupType = makeCandidate(direction, sweep, activeBos, geometry, atr);
    scores[direction] = scoreDirection(direction, {
      bias: structure.bias,
      bos: activeBos,
      choch,
      sweep,
      patterns,
      candle: current,
      geometry,
      volume,
      ema9: indicators?.ema9 ?? null,
      ema21: indicators?.ema21 ?? null,
      emaSlope,
      regime,
      setupType
    });
    if (setupType) signalCandidates.push({ direction, setupType });
  }

  if (!signalCandidates.length) return { signals: [], rejections: [], indicators, structure, events: eventList };
  const health = options.providerHealth ?? { stale: false, inconsistent: false };
  const isExtreme = atr > 0 && geometry.range > 3 * atr;
  if (health.stale || health.inconsistent) hardRejections.push("PROVIDER_STALE_OR_INCONSISTENT");
  if (isExtreme && options.allowExtremeVolatility !== true) hardRejections.push("EXTREME_VOLATILITY");
  if (!Number.isFinite(atr) || atr <= 0) hardRejections.push("ATR_UNAVAILABLE");
  if (options.rejectCountertrendRegime === true && signalCandidates.some((candidate) =>
    regime !== "neutral" && regime !== "ranging" && candidate.direction !== regime)) {
    hardRejections.push("REGIME_FILTER");
  }
  rejections.push(...hardRejections);
  const signals = [];
  for (const candidate of signalCandidates) {
    const own = scores[candidate.direction];
    const opposing = scores[candidate.direction === "bullish" ? "bearish" : "bullish"];
    const separation = own.normalizedScore - opposing.normalizedScore;
    if (own.normalizedScore < (options.minimumScore ?? 65)) {
      rejections.push(`${candidate.direction.toUpperCase()}_SCORE_BELOW_THRESHOLD`);
      continue;
    }
    if (separation < (options.minimumSeparation ?? 15)) {
      rejections.push(`${candidate.direction.toUpperCase()}_DIRECTIONAL_SEPARATION`);
      continue;
    }
    if (hardRejections.length) continue;
    const signalTimestamp = current.timestamp + current.timeframeSeconds * 1000;
    const target = calculateTarget({
      direction: candidate.direction,
      entryReference: current.close,
      atr,
      swings: knownSwings,
      timestamp: signalTimestamp,
      timeframeSeconds: current.timeframeSeconds,
      multiplier: options.targetAtrMultiplier ?? 1,
      horizonCandles: options.targetHorizonCandles ?? 3
    });
    if (!target.available) {
      rejections.push("TARGET_UNAVAILABLE");
      continue;
    }
    const key = JSON.stringify([
      current.symbol, current.timeframeSeconds, signalTimestamp, STRATEGY_VERSION,
      candidate.setupType, candidate.direction
    ]);
    if (options.seenSignalKeys?.has(key)) {
      rejections.push("DUPLICATE_SIGNAL");
      continue;
    }
    signals.push({
      id: key,
      strategyVersion: STRATEGY_VERSION,
      symbol: current.symbol,
      timeframeSeconds: current.timeframeSeconds,
      signalTimestamp,
      signalCandleTimestamp: current.timestamp,
      direction: candidate.direction,
      setupType: candidate.setupType,
      score: own.normalizedScore,
      directionalSeparation: separation,
      componentScores: own.components,
      supportingEvidence: [
        ...(sweep ? [sweep.type] : []),
        ...eventList.map((event) => event.type),
        ...Object.entries(patterns).filter(([, matches]) => matches).map(([name]) => name)
      ],
      contradictingEvidence: structure.bias !== "neutral" && structure.bias !== candidate.direction
        ? [`${structure.bias.toUpperCase()}_STRUCTURE`] : [],
      entryReference: current.close,
      targetPrice: target.targetPrice,
      targetTimestamp: target.targetTimestamp,
      target,
      invalidationPrice: sweep?.level ?? activeBos?.brokenLevel ?? null,
      forecastHorizons: [1, 2, 3],
      dataQuality: {
        volumeType: current.volumeType,
        volumeAvailable: current.volume !== null,
        atr,
        candleTimestamp: current.timestamp,
        candleClosed: current.isClosed
      },
      status: "CONFIRMED",
      outcomeRecords: [],
      inputSnapshot: {
        candles: completed,
        knownStructure: structure,
        indicators,
        liquiditySweep: sweep,
        structureEvents: eventList
      }
    });
    options.seenSignalKeys?.add(key);
  }
  return { signals, rejections, indicators, structure, events: eventList, scores, sweep };
}

function candleDirection(candle) {
  if (candle.close > candle.open) return "bullish";
  if (candle.close < candle.open) return "bearish";
  return "neutral";
}
