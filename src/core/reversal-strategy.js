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

export function analyzeReversalSetup(analysis, {
  indicator,
  minimumRuleCount = 2,
  durationSeconds = 15
} = {}) {
  if (!Number.isSafeInteger(minimumRuleCount) || minimumRuleCount < 1 ||
      minimumRuleCount > 8) {
    throw new RangeError("Choose between 1 and 8 matching reversal rules.");
  }
  if (!Number.isSafeInteger(durationSeconds) || ![15, 30, 60].includes(durationSeconds)) {
    throw new RangeError("Choose a 15, 30, or 60 second contract expiry.");
  }
  if (!analysis?.ready) {
    return {
      ready: false,
      direction: "neutral",
      rules: [],
      durationSeconds: null,
      reason: analysis?.reason ?? "Waiting for a completed candle and reversal baseline."
    };
  }
  if (!indicator?.ready) {
    return {
      ready: false,
      direction: "neutral",
      rules: [],
      durationSeconds: null,
      reason: indicator?.reason ?? "Waiting for RSI and Bollinger confirmation."
    };
  }
  if (!indicator.confirmed || !["bullish", "bearish"].includes(indicator.direction)) {
    return {
      ready: true,
      direction: "neutral",
      rules: [],
      durationSeconds: null,
      reason: indicator.reason
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
      durationSeconds: null,
      reason: "Conflicting reversal evidence in VPA at key levels; skip this setup."
    };
  }

  const direction = uniqueRules[0]?.direction ?? "neutral";
  if (direction !== "neutral" && direction !== indicator.direction) {
    return {
      ready: true,
      direction: "neutral",
      rules: uniqueRules,
      durationSeconds: null,
      reason: "RSI/Bollinger and VPA reversal evidence disagree; skip this setup."
    };
  }
  if (uniqueRules.length < minimumRuleCount) {
    return {
      ready: true,
      direction: "neutral",
      rules: uniqueRules,
      durationSeconds: null,
      reason: `Need ${minimumRuleCount} matching reversal rules at a key level; ${uniqueRules.length} qualified.`
    };
  }

  return {
    ready: true,
    direction,
    rules: uniqueRules,
    durationSeconds,
    reason: `${direction === "bullish" ? "Rise" : "Fall"} reversal: RSI/Bollinger confirmed with ${uniqueRules.length} matching VPA rule(s) at a key level.`
  };
}
