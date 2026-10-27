function utcDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function ledgerKey(accountId) {
  return `vpaEdgeTradingLedger:${accountId}`;
}

export function createTradingLedger(accountId, now = Date.now()) {
  if (typeof accountId !== "string" || !accountId) {
    throw new TypeError("Account ID is required for the trading ledger.");
  }
  return {
    accountId,
    date: utcDate(now),
    realizedPnl: 0,
    tradeTimes: [],
    openContract: null,
    tradeLog: []
  };
}

export function loadTradingLedger(storage, accountId, now = Date.now()) {
  const key = ledgerKey(accountId);
  const serialized = storage.getItem(key);
  if (serialized === null) return createTradingLedger(accountId, now);
  let ledger;
  try {
    ledger = JSON.parse(serialized);
  } catch {
    throw new Error("Saved bot risk ledger is invalid; clear it before starting.");
  }
  if (ledger.accountId !== accountId || !Array.isArray(ledger.tradeTimes) ||
      !Array.isArray(ledger.tradeLog) || !Number.isFinite(ledger.realizedPnl)) {
    throw new Error("Saved bot risk ledger does not match the selected account.");
  }
  if (ledger.date !== utcDate(now)) {
    return {
      ...createTradingLedger(accountId, now),
      tradeTimes: ledger.tradeTimes.filter((timestamp) =>
        Number.isFinite(timestamp) && now >= timestamp && now - timestamp < 60 * 60 * 1000),
      openContract: ledger.openContract ?? null,
      tradeLog: Array.isArray(ledger.tradeLog) ? ledger.tradeLog.slice(0, 100) : []
    };
  }
  return {
    ...ledger,
    tradeTimes: ledger.tradeTimes.filter((timestamp) => Number.isFinite(timestamp)),
    tradeLog: ledger.tradeLog.slice(-100)
  };
}

export function saveTradingLedger(storage, ledger) {
  storage.setItem(ledgerKey(ledger.accountId), JSON.stringify(ledger));
}

export function recordBotPurchase(ledger, { contractId, direction, stake, timestamp, candleTimestamp }) {
  if (!Number.isSafeInteger(Number(contractId)) || Number(contractId) <= 0 ||
      !["bullish", "bearish"].includes(direction) ||
      !Number.isFinite(stake) || stake <= 0 || !Number.isFinite(timestamp)) {
    throw new TypeError("Invalid confirmed contract purchase.");
  }
  const updated = {
    ...ledger,
    tradeTimes: [...ledger.tradeTimes, timestamp],
    openContract: {
      contractId: Number(contractId),
      direction,
      stake,
      candleTimestamp,
      purchaseTimestamp: timestamp
    },
    tradeLog: [{
      contractId: Number(contractId),
      direction,
      stake,
      timestamp,
      result: "OPEN",
      profit: null
    }, ...ledger.tradeLog].slice(0, 100)
  };
  return updated;
}

export function reserveBotPurchase(ledger, { direction, stake, timestamp, candleTimestamp }) {
  if (ledger.openContract) throw new Error("A bot contract is already pending or open.");
  if (!["bullish", "bearish"].includes(direction) ||
      !Number.isFinite(stake) || stake <= 0 || !Number.isFinite(timestamp)) {
    throw new TypeError("Invalid pending contract reservation.");
  }
  return {
    ...ledger,
    tradeTimes: [...ledger.tradeTimes, timestamp],
    openContract: {
      contractId: null,
      direction,
      stake,
      candleTimestamp,
      purchaseTimestamp: timestamp,
      status: "BUY_PENDING"
    }
  };
}

export function confirmBotPurchase(ledger, { contractId, direction, stake, timestamp, candleTimestamp }) {
  if (!ledger.openContract || ledger.openContract.status !== "BUY_PENDING") {
    throw new Error("No pending bot purchase reservation exists.");
  }
  if (!Number.isSafeInteger(Number(contractId)) || Number(contractId) <= 0) {
    throw new TypeError("Invalid confirmed contract ID.");
  }
  const updated = {
    ...ledger,
    openContract: {
      contractId: Number(contractId),
      direction,
      stake,
      candleTimestamp,
      purchaseTimestamp: timestamp,
      status: "OPEN"
    },
    tradeLog: [{
      contractId: Number(contractId),
      direction,
      stake,
      timestamp,
      result: "OPEN",
      profit: null
    }, ...ledger.tradeLog].slice(0, 100)
  };
  return updated;
}

export function recordBotSettlement(ledger, { contractId, profit, timestamp }) {
  if (!ledger.openContract || ledger.openContract.contractId !== Number(contractId)) {
    return { ledger, settled: false };
  }
  const realizedProfit = Number(profit);
  if (!Number.isFinite(realizedProfit)) {
    throw new TypeError("Deriv settlement did not include a valid realized profit.");
  }
  const tradeLog = ledger.tradeLog.map((trade) =>
    trade.contractId === Number(contractId)
      ? { ...trade, result: realizedProfit >= 0 ? "WON" : "LOST", profit: realizedProfit, settledAt: timestamp }
      : trade
  );
  return {
    ledger: {
      ...ledger,
      realizedPnl: ledger.realizedPnl + realizedProfit,
      openContract: null,
      tradeLog
    },
    settled: true
  };
}

export function recentBotTrades(ledger, now = Date.now()) {
  return ledger.tradeTimes.filter((timestamp) =>
    now >= timestamp && now - timestamp < 60 * 60 * 1000
  );
}
