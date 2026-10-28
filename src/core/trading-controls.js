export function validateTradingConfig(config) {
  if (!["demo", "real"].includes(config.accountType)) {
    throw new TypeError("Choose a demo or real account.");
  }
  if (config.accountType === "real" && config.realAccountConfirmed !== true) {
    throw new Error("Confirm the real-account risk acknowledgement before starting.");
  }
  if (typeof config.accountId !== "string" || !config.accountId) {
    throw new TypeError("Choose a Deriv account.");
  }
  if (!Number.isFinite(config.stake) || config.stake <= 0) {
    throw new RangeError("Stake must be greater than zero.");
  }
  if (!Number.isSafeInteger(config.duration) || config.duration <= 0 ||
      !["t", "s", "m"].includes(config.durationUnit)) {
    throw new RangeError("Choose a valid contract duration and unit.");
  }
  if (!Number.isFinite(config.dailyLossLimit) || config.dailyLossLimit <= 0) {
    throw new RangeError("Set a daily loss stop greater than zero.");
  }
  if (!Number.isSafeInteger(config.minimumRuleCount) ||
      config.minimumRuleCount < 1 || config.minimumRuleCount > 8) {
    throw new RangeError("Choose between 1 and 8 matching VPA rules.");
  }
  return true;
}

export function shouldPlaceFromSignal(analysis, minimumRuleCount) {
  if (!analysis?.ready || !["bullish", "bearish"].includes(analysis.direction)) {
    return false;
  }
  const matchingRules = analysis.rules.filter((rule) =>
    rule.direction === analysis.direction).length;
  return matchingRules >= minimumRuleCount;
}

export function getTradingLimitReason({
  realizedLoss,
  dailyLossLimit,
  hasOpenTrade
}) {
  if (hasOpenTrade) return "Waiting for the current contract to settle.";
  if (realizedLoss >= dailyLossLimit) return "Daily loss stop reached; bot halted.";
  return null;
}
