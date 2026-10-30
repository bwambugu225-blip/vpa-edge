import test from "node:test";
import assert from "node:assert/strict";
import {
  createTradingLedger,
  loadTradingLedger,
  recentBotTrades,
  confirmBotPurchase,
  recordBotPurchase,
  recordBotSettlement,
  reserveBotPurchase,
  saveTradingLedger
} from "../src/core/trade-ledger.js";
import { getTradingLimitReason, shouldPlaceFromSignal, validateTradingConfig } from "../src/core/trading-controls.js";

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("validates mandatory account, stake, duration, and risk controls", () => {
  const config = {
    accountType: "demo",
    accountId: "CR12345",
    stake: 0.35,
    duration: 15,
    durationUnit: "s",
    dailyLossLimit: 10,
    minimumRuleCount: 1,
    realAccountConfirmed: false
  };
  assert.equal(validateTradingConfig(config), true);
  assert.throws(() => validateTradingConfig({ ...config, dailyLossLimit: 0 }), /daily loss stop/);
  assert.throws(() => validateTradingConfig({ ...config, accountType: "real" }), /real-account/);
  assert.throws(() => validateTradingConfig({ ...config, duration: 10 }), /15, 30, or 60/);
  assert.throws(() => validateTradingConfig({ ...config, duration: 10 }), /15, 30, or 60/);
});

test("only starts on a directional signal with the configured VPA confluence", () => {
  const analysis = {
    ready: true,
    direction: "bullish",
    rules: [
      { direction: "bullish" },
      { direction: "bearish" },
      { direction: "bullish" }
    ]
  };
  assert.equal(shouldPlaceFromSignal(analysis, 2), true);
  assert.equal(shouldPlaceFromSignal(analysis, 3), false);
  assert.equal(shouldPlaceFromSignal({ ...analysis, direction: "neutral" }, 1), false);
  assert.equal(shouldPlaceFromSignal({ ...analysis, ready: false }, 1), false);
});

test("persists daily realized bot P/L and resets it at UTC date boundary", () => {
  const storage = makeStorage();
  const now = Date.UTC(2026, 9, 27, 12);
  const initial = createTradingLedger("CR12345", now);
  const purchased = recordBotPurchase(initial, {
    contractId: 123,
    direction: "bullish",
    stake: 0.35,
    timestamp: now,
    candleTimestamp: now - 5000,
    symbol: "R_100"
  });
  assert.equal(purchased.openContract.symbol, "R_100");
  assert.equal(purchased.tradeLog[0].symbol, "R_100");
  const settled = recordBotSettlement(purchased, {
    contractId: 123,
    profit: -0.35,
    timestamp: now + 5000
  });
  assert.equal(settled.settled, true);
  assert.equal(settled.ledger.realizedPnl, -0.35);
  assert.equal(settled.ledger.openContract, null);
  saveTradingLedger(storage, settled.ledger);
  assert.equal(loadTradingLedger(storage, "CR12345", now).realizedPnl, -0.35);
  assert.equal(loadTradingLedger(storage, "CR12345", now + 86400000).realizedPnl, 0);
});

test("allows another order after settlement while blocking duplicate open contracts", () => {
  const now = Date.UTC(2026, 9, 27, 12);
  const initial = createTradingLedger("CR12345", now);
  const reserved = reserveBotPurchase(initial, {
    direction: "bearish",
    stake: 0.35,
    timestamp: now,
    candleTimestamp: now - 5000
  });
  assert.equal(reserved.openContract.status, "BUY_PENDING");
  assert.equal(reserved.tradeTimes.length, 1);
  const confirmed = confirmBotPurchase(reserved, {
    contractId: 321,
    direction: "bearish",
    stake: 0.35,
    timestamp: now,
    candleTimestamp: now - 5000
  });
  assert.equal(confirmed.openContract.contractId, 321);
  assert.equal(confirmed.tradeTimes.length, 1);
  assert.throws(() => reserveBotPurchase(confirmed, {
    direction: "bullish",
    stake: 0.35,
    timestamp: now + 5000,
    candleTimestamp: now
  }), /already pending or open/);
  const settled = recordBotSettlement(confirmed, {
    contractId: 321,
    profit: 0.2,
    timestamp: now + 10000
  });
  assert.equal(settled.settled, true);
  const secondOrder = reserveBotPurchase(settled.ledger, {
    direction: "bullish",
    stake: 0.35,
    timestamp: now + 15000,
    candleTimestamp: now + 10000
  });
  assert.equal(secondOrder.tradeTimes.length, 2);
  assert.equal(secondOrder.openContract.status, "BUY_PENDING");
});

test("trade count is informational while open contracts and daily loss stop block orders", () => {
  const now = 10000000;
  const manyTrades = Array.from({ length: 500 }, (_, index) => now - index * 1000);
  assert.equal(recentBotTrades({ tradeTimes: manyTrades }, now).length, 500);
  const common = {
    realizedLoss: 0,
    dailyLossLimit: 1,
    hasOpenTrade: false
  };
  assert.equal(getTradingLimitReason(common), null);
  assert.match(getTradingLimitReason({ ...common, hasOpenTrade: true }), /current contract/);
  assert.match(getTradingLimitReason({ ...common, realizedLoss: 1 }), /Daily loss stop/);
});
