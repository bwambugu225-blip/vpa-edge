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
  if (!Number.isFinite(config.dailyLossLimit) || config.dailyLossLimit <= 0) {
    throw new RangeError("Set a daily loss stop greater than zero.");
  }
  if (config.duration !== 15 ||
      config.durationUnit !== "s") {
    throw new RangeError("The bot uses a fixed 15-second contract expiry.");
  }
  if (config.marketSelection !== "ALL" &&
      (typeof config.marketSelection !== "string" ||
       !/^\w{2,30}$/.test(config.marketSelection))) {
    throw new TypeError("Choose all eligible markets or a valid market symbol.");
  }
  if (!Number.isSafeInteger(config.minimumRuleCount) ||
      config.minimumRuleCount < 1 || config.minimumRuleCount > 8) {
    throw new RangeError("Choose between 1 and 8 matching VPA rules.");
  }
  return true;
}

export function getBotToggleState({ botRunning, startAttemptPending, canStart }) {
  if (botRunning) return { disabled: false, label: "Stop bot" };
  if (startAttemptPending) return { disabled: false, label: "Cancel start" };
  return { disabled: !canStart, label: "Start bot" };
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
