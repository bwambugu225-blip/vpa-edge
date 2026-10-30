const REVERSAL_RULES = new Map([
  ["ABSORPTION_TRAP", "support"],
  ["STOPPING_VOLUME", "support"],
  ["SELLING_CLIMAX", "support"],
  ["HIGH_VOLUME_PIN_BAR", "support"],
  ["BEARISH_EFFORT_LOWER_THAN_RESULT", "support"],
  ["BEARISH_EFFORT_HIGHER_THAN_RESULT", "support"],
  ["NO_SUPPLY", "support"],
  ["EXTREME_VOLUME_WARNING", "resistance"],
  ["VOLUME_DIVERGENCE", "resistance"]
]);

export function analyzeReversalSetup(analysis, { minimumRuleCount = 2 } = {}) {
  if (!Number.isSafeInteger(minimumRuleCount) || minimumRuleCount < 1 ||
      minimumRuleCount > 8) {
    throw new RangeError("Choose between 1 and 8 matching reversal rules.");
  }
  if (!analysis?.ready) {
    return {
      ready: false,
      direction: "neutral",
      rules: [],
      durationCandles: null,
      reason: analysis?.reason ?? "Waiting for a completed candle and reversal baseline."
    };
  }

  const candidates = analysis.rules.filter((rule) => {
    const level = REVERSAL_RULES.get(rule.id);
    if (!level || !["bullish", "bearish"].includes(rule.direction)) return false;
    return level === "support"
      ? analysis.nearSupport === true && rule.direction === "bullish"
      : analysis.nearResistance === true && rule.direction === "bearish";
  });
  const uniqueRules = [...new Map(candidates.map((rule) => [rule.id, rule])).values()];
  const directions = new Set(uniqueRules.map((rule) => rule.direction));
  if (directions.size > 1) {
    return {
      ready: true,
      direction: "neutral",
      rules: uniqueRules,
      durationCandles: null,
      reason: "Conflicting reversal evidence at key levels; skip this setup."
    };
  }

  const direction = uniqueRules[0]?.direction ?? "neutral";
  if (uniqueRules.length < minimumRuleCount) {
    return {
      ready: true,
      direction: "neutral",
      rules: uniqueRules,
      durationCandles: null,
      reason: `Need ${minimumRuleCount} matching reversal rules at a key level; ${uniqueRules.length} qualified.`
    };
  }

  const activityBonus = analysis.relativeVolume >= 2 ? 1 : 0;
  const spreadBonus = analysis.rangeRatio >= 1.4 ? 1 : 0;
  const evidenceStrength = uniqueRules.length + activityBonus + spreadBonus;
  const durationCandles = Math.max(1, Math.min(5, evidenceStrength));
  return {
    ready: true,
    direction,
    rules: uniqueRules,
    evidenceStrength,
    durationCandles,
    reason: `${direction === "bullish" ? "Rise" : "Fall"} reversal: ${uniqueRules.length} matching rule(s) at a key level.`
  };
}
