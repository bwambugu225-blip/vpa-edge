import {
  CANDLE_TIMEFRAME_SECONDS,
  DerivMarketFeed,
  DERIV_API_BASE_URL
} from "./src/data/deriv-market-feed.js";
import { DerivMarketScanner } from "./src/data/deriv-market-scanner.js";
import { analyzeVpa } from "./src/core/vpa-engine.js";
import { analyzeReversalSetup } from "./src/core/reversal-strategy.js";
import { analyzeOverboughtOversold } from "./src/core/overbought-oversold-indicator.js";
import { DerivTradingClient } from "./src/data/deriv-trading-client.js";
import { getTradingLimitReason, validateTradingConfig } from "./src/core/trading-controls.js";
import {
  confirmBotPurchase,
  loadTradingLedger,
  recentBotTrades,
  recordBotSettlement,
  reserveBotPurchase,
  saveTradingLedger
} from "./src/core/trade-ledger.js";

const DERIV_APP_ID = "34Nkapu58DUiFIAqSfSky";
const elements = Object.fromEntries([
  "connection-pill", "symbol", "start", "stop", "market-status", "price",
  "market-symbol", "ticks", "bars", "activity-metric", "chart-title", "chart",
  "scanner-status", "rescan-markets", "scanner-markets", "scanner-signal",
  "chart-empty", "candle-chart", "ohlc", "signal-chip", "signal-direction",
  "analysis-reason", "analysis-quality", "rule-list", "checklist", "pat",
  "validate-pat", "account-status", "account", "stake", "currency-readout",
  "expiry-seconds", "daily-loss", "min-rules",
  "real-confirm", "start-bot", "stop-bot", "bot-status-chip", "bot-status",
  "bot-pnl", "hourly-count", "open-contract", "trade-log", "recover-contract",
  "reconcile-pending"
].map((id) => [id, document.getElementById(id)]));

elements.pat.value = "";
let feed;
let scanner;
let latestCandles = [];
let latestMarketSnapshot = null;
let latestScannerSnapshot = null;
let latestScannerSetup = null;
let accounts = [];
let patInMemory = null;
let tradingClient = null;
let unsubscribeTrading = null;
let botRunning = false;
let botConfig = null;
let tradingLedger = null;
let orderInFlight = false;
const lastHandledCandleTimestamps = new Map();
let lastSelectedAccountId = "";
let tradingAccountId = null;
let ledgerError = null;
let releaseTradeLock = null;
let availableBalance = null;
let botStatusMessage = "Live market data starts automatically. Load a trade-scoped PAT only when you are ready to authorize trading.";
let startAttemptPending = false;
let botStartGeneration = 0;

function price(value) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(8))) : "—";
}

function setConnection(status, error = null) {
  const live = status === "streaming";
  elements["connection-pill"].className =
    `connection-pill${live ? " live" : status === "error" ? " error" : ""}`;
  const statusText = {
    connecting: "Connecting",
    loading_history: "Loading history",
    streaming: "Live",
    reconnecting: "Reconnecting",
    disconnected: "Disconnected",
    error: "Feed error"
  }[status] ?? status;
  elements["connection-pill"].lastChild.textContent = ` ${statusText}`;
  elements["market-status"].textContent = error || ({
    connecting: "Opening Deriv public market-data connection…",
    loading_history: "Connected. Importing the latest 500 ticks…",
    streaming: `Streaming ${elements.symbol.value.trim()} · 5-second candles`,
    reconnecting: "Connection interrupted. Reconnecting and refreshing tick history…",
    disconnected: "Feed stopped.",
    error: "Could not connect to Deriv."
  }[status] ?? statusText);
  elements.start.disabled = ["connecting", "loading_history", "streaming", "reconnecting"].includes(status);
  elements.stop.disabled = ["disconnected", "error"].includes(status);
}

function drawCandles(candles) {
  const svg = elements["candle-chart"];
  svg.replaceChildren();
  const closed = candles.filter((candle) => candle.isClosed).slice(-48);
  elements["chart-empty"].hidden = closed.length > 0;
  if (!closed.length) return;

  const width = 760;
  const height = 280;
  const padding = { top: 16, right: 12, bottom: 14, left: 12 };
  const highs = closed.map((candle) => candle.high);
  const lows = closed.map((candle) => candle.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min || Math.abs(max) * 0.0001 || 1;
  const y = (value) => padding.top + ((max - value) / span) * (height - padding.top - padding.bottom);
  const step = (width - padding.left - padding.right) / closed.length;
  const bodyWidth = Math.max(3, Math.min(10, step * 0.52));
  const frag = document.createDocumentFragment();

  for (let index = 0; index < closed.length; index += 1) {
    const candle = closed[index];
    const x = padding.left + step * (index + 0.5);
    const color = candle.close >= candle.open ? "#64d5a8" : "#ff777d";
    const wick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    wick.setAttribute("x1", x);
    wick.setAttribute("x2", x);
    wick.setAttribute("y1", y(candle.high));
    wick.setAttribute("y2", y(candle.low));
    wick.setAttribute("stroke", color);
    wick.setAttribute("stroke-width", "1.25");
    frag.append(wick);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const bodyY = Math.min(y(candle.open), y(candle.close));
    rect.setAttribute("x", x - bodyWidth / 2);
    rect.setAttribute("y", bodyY);
    rect.setAttribute("width", bodyWidth);
    rect.setAttribute("height", Math.max(1.5, Math.abs(y(candle.open) - y(candle.close))));
    rect.setAttribute("rx", "1");
    rect.setAttribute("fill", color);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${new Date(candle.timestamp).toLocaleTimeString()} O ${price(candle.open)} H ${price(candle.high)} L ${price(candle.low)} C ${price(candle.close)} · ${candle.volume} ticks`;
    rect.append(title);
    frag.append(rect);
  }
  svg.append(frag);
}

function renderRules(analysis) {
  const root = elements["rule-list"];
  root.replaceChildren();
  if (!analysis?.rules?.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = analysis?.ready ? "No reversal pattern qualified at a key level." : "Reversal rules are waiting for enough completed candles.";
    root.append(empty);
    return;
  }
  for (const rule of analysis.rules) {
    const card = document.createElement("div");
    card.className = `rule-card ${rule.direction}`;
    const name = document.createElement("strong");
    name.textContent = `${rule.direction === "bullish" ? "RISE" : "FALL"} · ${rule.id.replaceAll("_", " ")}`;
    const description = document.createElement("span");
    description.textContent = rule.description;
    card.append(name, description);
    root.append(card);
  }
}

function renderChecklist(analysis) {
  const root = elements.checklist;
  root.replaceChildren();
  const checks = [
    ["volumeIncreasing", "Is tick activity increasing versus recent bars?"],
    ["effortMatchesResult", "Does activity match the candle's price spread?"],
    ["unusualVolume", "Is there an unusual activity spike near a key level?"],
    ["volumeDivergence", "Is price diverging from activity at a new high?"]
  ];
  if (!analysis?.ready) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "The checklist appears after the VPA baseline is ready.";
    root.append(message);
    return;
  }
  for (const [key, label] of checks) {
    const value = analysis.checklist[key];
    const row = document.createElement("div");
    row.className = `check-item ${value === true ? "yes" : value === false ? "no" : ""}`;
    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.textContent = value === true ? "✓" : value === false ? "–" : "?";
    const text = document.createElement("span");
    text.textContent = label;
    row.append(icon, text);
    root.append(row);
  }
}

function selectedAccount() {
  return accounts.find((account) => account.account_id === elements.account.value) ?? null;
}

function setBotStatus(message, state = "neutral") {
  botStatusMessage = message;
  elements["bot-status"].textContent = message;
  const status = botRunning ? "RUNNING" : startAttemptPending ? "STARTING" : state === "error" ? "ERROR" : "STOPPED";
  elements["bot-status-chip"].textContent = status;
  elements["bot-status-chip"].className = `signal-chip ${botRunning ? "bullish" : state === "error" ? "bearish" : "neutral"}`;
}

function renderTradeLog() {
  elements["trade-log"].replaceChildren();
  for (const trade of tradingLedger?.tradeLog ?? []) {
    const row = document.createElement("div");
    row.className = "trade-row";
    const label = document.createElement("span");
    const direction = trade.direction === "bullish" ? "RISE" : "FALL";
    label.textContent = `#${trade.contractId} ${trade.symbol ? `${trade.symbol} · ` : ""}${direction} · ${Number(trade.stake).toFixed(2)}`;
    const result = document.createElement("span");
    result.textContent = trade.result === "OPEN" ? "OPEN" : trade.result;
    const profit = document.createElement("b");
    profit.className = trade.profit > 0 ? "win" : trade.profit < 0 ? "loss" : "";
    profit.textContent = trade.profit === null ? "—" : `${trade.profit > 0 ? "+" : ""}${Number(trade.profit).toFixed(2)}`;
    row.append(label, result, profit);
    elements["trade-log"].append(row);
  }
}

function renderTradingState() {
  const account = selectedAccount();
  elements["currency-readout"].value = account?.currency ?? "From account";
  elements["bot-pnl"].textContent = tradingLedger
    ? `${tradingLedger.realizedPnl > 0 ? "+" : ""}${tradingLedger.realizedPnl.toFixed(2)} ${account?.currency ?? ""}`
    : `0.00 ${account?.currency ?? ""}`;
  const now = Date.now();
  const trades = tradingLedger ? recentBotTrades(tradingLedger, now) : [];
  elements["hourly-count"].textContent = String(trades.length);
  const openContract = tradingLedger?.openContract;
  elements["open-contract"].textContent = !openContract ? "None"
    : openContract.contractId ? `#${openContract.contractId}${openContract.symbol ? ` · ${openContract.symbol}` : ""} · ${openContract.status ?? "OPEN"}`
      : "Order state unknown · reconcile";
  const botBusy = botRunning || startAttemptPending || orderInFlight;
  elements.account.disabled = Boolean(botBusy || openContract);
  elements["validate-pat"].disabled = Boolean(botBusy || (openContract && tradingClient?.isConnected));
  elements.pat.disabled = Boolean(botBusy || (openContract && tradingClient?.isConnected));
  for (const control of [
    elements.stake,
    elements["expiry-seconds"], elements["daily-loss"], elements["min-rules"],
    elements["real-confirm"]
  ]) {
    control.disabled = botBusy;
  }
  elements.symbol.disabled = botBusy;
  elements["recover-contract"].hidden = !openContract || !openContract.contractId ||
    Boolean(tradingClient?.isConnected) || !patInMemory;
  elements["reconcile-pending"].hidden = !openContract ||
    Boolean(openContract.contractId) || botRunning || orderInFlight;
  renderTradeLog();
  refreshTradingControls();
  setBotStatus(ledgerError ?? botStatusMessage, ledgerError ? "error" : "neutral");
}

function refreshTradingControls() {
  const account = selectedAccount();
  const canStart = Boolean(account &&
    (patInMemory || (tradingClient && tradingAccountId === account.account_id)) &&
    latestScannerSnapshot?.ready && latestScannerSnapshot.status === "streaming" &&
    !ledgerError && !botRunning && !startAttemptPending && !orderInFlight &&
    !tradingLedger?.openContract);
  elements["start-bot"].disabled = !canStart;
  elements["stop-bot"].disabled = !(botRunning || startAttemptPending);
  elements["start-bot"].textContent = botRunning
    ? "Bot running"
    : startAttemptPending ? "Starting…" : "Start bot";
  elements["stop-bot"].textContent = startAttemptPending ? "Cancel start" : "Stop new orders";
}

function setAccounts(nextAccounts) {
  accounts = nextAccounts.filter((account) => account.status === "active");
  elements.account.replaceChildren();
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.account_id;
    option.textContent = `${account.account_type.toUpperCase()} · ${account.account_id} · ${account.currency}`;
    elements.account.append(option);
  }
  elements.account.disabled = accounts.length === 0;
  if (!accounts.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No active Options accounts";
    elements.account.append(option);
  }
  if (accounts.length) {
    const demo = accounts.find((account) => account.account_type === "demo") ?? accounts[0];
    elements.account.value = demo.account_id;
    lastSelectedAccountId = demo.account_id;
    loadLedgerForAccount(demo.account_id);
  }
  renderTradingState();
}

function loadLedgerForAccount(accountId) {
  try {
    tradingLedger = loadTradingLedger(localStorage, accountId);
    ledgerError = null;
  } catch (error) {
    tradingLedger = null;
    ledgerError = error.message;
  }
}

function stopBot(message, state = "neutral") {
  if (startAttemptPending) botStartGeneration += 1;
  botRunning = false;
  if (message) setBotStatus(message, state);
  const hasOpenContract = Boolean(tradingLedger?.openContract);
  if (!hasOpenContract && tradingClient) {
    unsubscribeTrading?.();
    unsubscribeTrading = null;
    tradingClient.close();
    tradingClient = null;
    tradingAccountId = null;
    availableBalance = null;
  }
  if (!hasOpenContract) releaseAccountLock();
  renderTradingState();
}

function releaseAccountLock() {
  const release = releaseTradeLock;
  releaseTradeLock = null;
  if (release) release();
}

async function acquireAccountLock(accountId) {
  if (!navigator.locks?.request) {
    throw new Error("This browser cannot safely lock an account across tabs. Use a current Chrome browser.");
  }
  let resolveAcquired;
  let rejectAcquired;
  const acquired = new Promise((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  navigator.locks.request(`vpa-edge-trade:${accountId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) {
      resolveAcquired(false);
      return;
    }
    resolveAcquired(true);
    await new Promise((resolve) => {
      releaseTradeLock = resolve;
    });
  }).catch((error) => rejectAcquired(error));
  if (!await acquired) throw new Error("Another VPA Edge tab is already operating this account.");
}

function handleTradingMessage(message) {
  if (message.type === "error") {
    stopBot(`Deriv trading connection error: ${message.error}`, "error");
    return;
  }
  if (message.type === "disconnect") {
    stopBot("Deriv trading connection closed; automatic orders paused.", "error");
    return;
  }
  if (message.msg_type === "balance") {
    const balance = Number(message.balance?.balance);
    const currency = message.balance?.currency;
    if (Number.isFinite(balance)) availableBalance = balance;
    if (botRunning && botConfig && currency && currency !== botConfig.currency) {
      stopBot("Account currency changed during the session; automatic orders paused.", "error");
    }
    return;
  }
  if (message.msg_type !== "proposal_open_contract" || !tradingLedger?.openContract) return;
  const contract = message.proposal_open_contract;
  if (!contract || Number(contract.contract_id) !== tradingLedger.openContract.contractId) return;
  if (Number(contract.is_sold) !== 1 &&
      !["won", "lost", "sold"].includes(String(contract.status).toLowerCase())) return;
  try {
    const contractSymbol = tradingLedger.openContract.symbol;
    const settlement = recordBotSettlement(tradingLedger, {
      contractId: contract.contract_id,
      profit: contract.profit,
      timestamp: Date.now()
    });
    if (!settlement.settled) return;
    tradingLedger = settlement.ledger;
    saveTradingLedger(localStorage, tradingLedger);
    const currency = selectedAccount()?.currency ?? "";
    const summary = `Contract #${contract.contract_id}${contractSymbol ? ` on ${contractSymbol}` : ""} settled ${Number(contract.profit) >= 0 ? "with profit" : "at a loss"}: ${Number(contract.profit).toFixed(2)} ${currency}.`;
    const loss = Math.max(0, -tradingLedger.realizedPnl);
    const dailyLimit = Number(elements["daily-loss"].value);
    if (Number.isFinite(dailyLimit) && loss >= dailyLimit) {
      stopBot(`${summary} Daily loss stop reached; no further orders.`, "error");
    } else {
      setBotStatus(botRunning
        ? `${summary} Bot remains active and is waiting for the next fresh reversal setup.`
        : summary);
      renderTradingState();
      if (!botRunning && tradingClient) {
        unsubscribeTrading?.();
        unsubscribeTrading = null;
        tradingClient.close();
        tradingClient = null;
        tradingAccountId = null;
        availableBalance = null;
        releaseAccountLock();
      }
    }
  } catch (error) {
    stopBot(`Could not record contract settlement: ${error.message}`, "error");
  }
}

async function maybePlaceOrder(symbol, candle, candles) {
  if (!botRunning || !botConfig || !tradingClient || orderInFlight ||
      lastHandledCandleTimestamps.get(symbol) === candle.timestamp) return;
  lastHandledCandleTimestamps.set(symbol, candle.timestamp);
  const indicator = analyzeOverboughtOversold(candles);
  const analysis = analyzeReversalSetup(analyzeVpa(candles), {
    indicator,
    minimumRuleCount: botConfig.minimumRuleCount,
    durationSeconds: botConfig.duration
  });
  if (!analysis.ready || !["bullish", "bearish"].includes(analysis.direction) ||
      analysis.durationSeconds === null) return;
  if (!Number.isFinite(availableBalance) || availableBalance < botConfig.stake) {
    stopBot("Available balance is below the configured stake; automatic orders stopped.", "error");
    return;
  }
  const limitReason = getTradingLimitReason({
    realizedLoss: Math.max(0, -tradingLedger.realizedPnl),
    dailyLossLimit: botConfig.dailyLossLimit,
    hasOpenTrade: Boolean(tradingLedger.openContract)
  });
  if (limitReason) {
    if (limitReason.startsWith("Daily loss")) stopBot(limitReason, "error");
    else setBotStatus(limitReason);
    return;
  }

  orderInFlight = true;
  refreshTradingControls();
  setBotStatus(`Getting a live ${analysis.direction === "bullish" ? "Rise" : "Fall"} price proposal…`);
  let buyRequestStarted = false;
  let purchaseConfirmed = false;
  let confirmedContractId = null;
  let reservationTimestamp = null;
  try {
    const proposal = await tradingClient.requestRiseFallProposal({
      symbol,
      currency: botConfig.currency,
      direction: analysis.direction,
      stake: botConfig.stake,
      duration: analysis.durationSeconds,
      durationUnit: "s"
    });
    if (!botRunning) {
      setBotStatus("Bot stopped before the order request; no order was sent.");
      return;
    }
    reservationTimestamp = Date.now();
    tradingLedger = reserveBotPurchase(tradingLedger, {
      direction: analysis.direction,
      stake: botConfig.stake,
      timestamp: reservationTimestamp,
      candleTimestamp: candle.timestamp,
      symbol
    });
    saveTradingLedger(localStorage, tradingLedger);
    renderTradingState();

    setBotStatus(`Submitting ${analysis.direction === "bullish" ? "Rise" : "Fall"} order, capped at ${botConfig.stake.toFixed(2)} ${botConfig.currency}…`);
    buyRequestStarted = true;
    const purchase = await tradingClient.buyProposal(proposal, botConfig.stake);
    purchaseConfirmed = true;
    confirmedContractId = Number(purchase.contract_id);
    tradingLedger = confirmBotPurchase(tradingLedger, {
      contractId: purchase.contract_id,
      direction: analysis.direction,
      stake: botConfig.stake,
      timestamp: Date.now(),
      candleTimestamp: candle.timestamp,
      symbol
    });
    saveTradingLedger(localStorage, tradingLedger);
    setBotStatus(`Order #${purchase.contract_id} accepted on ${symbol}. Waiting for settlement.`);
    renderTradingState();
    await tradingClient.subscribeToContract(Number(purchase.contract_id));
  } catch (error) {
    const pending = tradingLedger?.openContract?.status === "BUY_PENDING";
    if (pending && !buyRequestStarted) {
      tradingLedger = {
        ...tradingLedger,
        tradeTimes: tradingLedger.tradeTimes.filter((timestamp) => timestamp !== reservationTimestamp),
        openContract: null
      };
      try {
        saveTradingLedger(localStorage, tradingLedger);
      } catch (saveError) {
        error = new Error(`${error.message}; risk ledger rollback also failed: ${saveError.message}`);
      }
      stopBot(`No order was sent: ${error.message}`, "error");
    } else if (pending && error.derivRejected) {
      tradingLedger = { ...tradingLedger, openContract: null };
      try {
        saveTradingLedger(localStorage, tradingLedger);
        stopBot(`Deriv rejected the order; no contract was purchased: ${error.message}`, "error");
      } catch (saveError) {
        stopBot(`Deriv rejected the order, but the risk ledger could not be updated: ${saveError.message}`, "error");
      }
    } else if (purchaseConfirmed) {
      botRunning = false;
      setBotStatus(`Contract #${confirmedContractId} was accepted, but monitoring/ledger update failed: ${error.message}. Check Deriv; no further orders will be sent.`, "error");
      try {
        await tradingClient?.subscribeToContract(confirmedContractId);
      } catch (monitorError) {
        setBotStatus(`Contract #${confirmedContractId} was accepted, but monitoring failed: ${monitorError.message}. Check Deriv manually.`, "error");
      }
      renderTradingState();
    } else {
      stopBot(pending
        ? `Order outcome uncertain: ${error.message} Check the Deriv account before reconciling. No retry was made.`
        : `No order placed: ${error.message}`, "error");
    }
  } finally {
    orderInFlight = false;
    refreshTradingControls();
  }
}

function render(snapshot) {
  latestMarketSnapshot = snapshot;
  latestCandles = snapshot.candles ?? [];
  const closed = latestCandles.filter((candle) => candle.isClosed);
  const latest = latestCandles.at(-1);
  const analysis = analyzeVpa(closed);
  const indicator = analyzeOverboughtOversold(closed);
  const reversal = analyzeReversalSetup(analysis, {
    indicator,
    minimumRuleCount: Number(elements["min-rules"].value),
    durationSeconds: Number(elements["expiry-seconds"].value)
  });
  setConnection(snapshot.status, snapshot.error);
  elements.price.textContent = price(snapshot.lastQuote);
  elements["market-symbol"].textContent = snapshot.symbol ?? "No market selected";
  elements.ticks.innerHTML = `${snapshot.ticksLoaded ?? 0} <small>/ 500</small>`;
  elements.bars.textContent = String(closed.length);
  elements["chart-title"].textContent = snapshot.symbol
    ? `${snapshot.symbol} · live price`
    : "Waiting for feed";
  elements.ohlc.textContent = latest
    ? `O ${price(latest.open)}   H ${price(latest.high)}   L ${price(latest.low)}   C ${price(latest.close)}`
    : "—";
  elements["activity-metric"].textContent = analysis.relativeVolume == null
    ? "—"
    : `${analysis.relativeVolume.toFixed(2)}×`;

  const direction = reversal.direction;
  const labels = {
    bullish: ["RISE REVERSAL", "Potential Rise reversal"],
    bearish: ["FALL REVERSAL", "Potential Fall reversal"],
    neutral: [analysis.ready ? "NO REVERSAL" : "WARMING UP", analysis.ready ? "No qualified reversal setup" : "Building VPA baseline"]
  };
  elements["signal-chip"].textContent = labels[direction][0];
  elements["signal-chip"].className = `signal-chip ${direction}`;
  elements["signal-direction"].textContent = labels[direction][1];
  elements["signal-direction"].className = `signal-direction ${direction}`;
  elements["analysis-reason"].textContent = reversal.reason;
  elements["analysis-quality"].textContent = indicator.ready
    ? `RSI(14) ${indicator.rsi.toFixed(1)} · %B ${indicator.percentB.toFixed(2)} · BB ${price(indicator.bands.lower)} / ${price(indicator.bands.upper)} · ${reversal.direction === "neutral" ? "no confirmed setup" : `${reversal.durationSeconds}s contract`}`
    : `${indicator.reason} · VPA uses tick activity, not centralized volume.`;
  renderRules({ ...analysis, rules: reversal.rules });
  renderChecklist(analysis);
  drawCandles(latestCandles);
  renderTradingState();
}

function renderScanner(snapshot) {
  latestScannerSnapshot = snapshot;
  const firstMarketError = snapshot.markets?.find((market) => market.error)?.error;
  const statusText = snapshot.error ??
    (snapshot.ready
      ? `Scanning ${snapshot.readyCount} live markets for ${snapshot.durationSeconds}-second Rise/Fall setups${snapshot.unsupportedCount ? ` · ${snapshot.unsupportedCount} expiry-unsupported` : ""}${snapshot.errorCount ? ` · ${snapshot.errorCount} market errors (${firstMarketError})` : ""}.`
      : snapshot.total
        ? `Preparing ${snapshot.total} open markets · ${snapshot.readyCount} live, ${snapshot.pendingCount} loading.`
        : "Discovering open Deriv markets and checking contract availability…");
  elements["scanner-status"].textContent = statusText;
  elements["scanner-signal"].textContent = latestScannerSetup
    ? `${latestScannerSetup.direction === "bullish" ? "RISE" : "FALL"} · ${latestScannerSetup.symbol} · ${latestScannerSetup.reason} · ${new Date(latestScannerSetup.timestamp + CANDLE_TIMEFRAME_SECONDS * 1000).toLocaleTimeString()}`
    : "No qualifying setup yet. Orders use the first new confirmed setup after the bot starts.";

  const root = elements["scanner-markets"];
  root.replaceChildren();
  const markets = [...(snapshot.markets ?? [])]
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .slice(0, 15);
  for (const market of markets) {
    const row = document.createElement("div");
    row.className = "scanner-row";
    const symbol = document.createElement("strong");
    symbol.textContent = market.symbol;
    const marketName = document.createElement("span");
    marketName.textContent = market.name;
    const quote = document.createElement("b");
    quote.textContent = Number.isFinite(market.lastQuote) ? price(market.lastQuote) : "—";
    const state = document.createElement("span");
    state.className = `scanner-state ${market.status}`;
    state.textContent = market.status.replaceAll("_", " ");
    state.title = market.error ?? "";
    row.append(symbol, marketName, quote, state);
    root.append(row);
  }
  if (snapshot.total > markets.length) {
    const more = document.createElement("p");
    more.className = "muted";
    more.textContent = `Showing 15 of ${snapshot.total} currently open markets. All eligible markets remain under scan.`;
    root.append(more);
  }
  elements["rescan-markets"].disabled = botRunning || startAttemptPending ||
    ["connecting", "loading_markets", "loading_history", "reconnecting"].includes(snapshot.status);
  refreshTradingControls();
  if (snapshot.status !== "streaming" && (botRunning || startAttemptPending)) {
    stopBot(snapshot.error || "Market scanner disconnected; automatic orders paused.", "error");
  }
}

function handleScannedCandle({ symbol, candle, candles }) {
  const indicator = analyzeOverboughtOversold(candles);
  const reversal = analyzeReversalSetup(analyzeVpa(candles), {
    indicator,
    minimumRuleCount: Number(elements["min-rules"].value),
    durationSeconds: Number(elements["expiry-seconds"].value)
  });
  if (["bullish", "bearish"].includes(reversal.direction)) {
    latestScannerSetup = {
      symbol,
      direction: reversal.direction,
      reason: reversal.reason,
      timestamp: candle.timestamp
    };
    if (latestScannerSnapshot) renderScanner(latestScannerSnapshot);
  }
  void maybePlaceOrder(symbol, candle, candles);
}

function startMarket(symbol) {
  if (feed) feed.stop();
  feed = new DerivMarketFeed({
    onUpdate: (snapshot) => render(snapshot),
    onClosedCandle: (candle, candles) => {
      render({ ...feed.getSnapshot(), candles });
    }
  });
  try {
    feed.start(symbol);
    if (!scanner || scanner.stopped || latestScannerSnapshot?.status === "error") {
      startScanner(Number(elements["expiry-seconds"].value));
    }
  } catch (error) {
    setConnection("error", error.message);
  }
}

function startScanner(durationSeconds) {
  latestScannerSetup = null;
  if (!scanner) {
    scanner = new DerivMarketScanner({
      onUpdate: (snapshot) => renderScanner(snapshot),
      onClosedCandle: handleScannedCandle
    });
  }
  try {
    scanner.start(durationSeconds);
  } catch (error) {
    renderScanner({
      status: "error",
      error: error.message,
      durationSeconds,
      ready: false,
      readyCount: 0,
      pendingCount: 0,
      unsupportedCount: 0,
      errorCount: 0,
      total: 0,
      markets: []
    });
  }
}

async function ensureTradingConnection(account) {
  if (tradingClient && tradingAccountId === account.account_id && tradingClient.isConnected) {
    return tradingClient;
  }
  if (!patInMemory) throw new Error("Load accounts with a trade-scoped PAT first.");
  if (tradingClient) {
    unsubscribeTrading?.();
    tradingClient.close();
    tradingClient = null;
    tradingAccountId = null;
  }
  const client = new DerivTradingClient();
  tradingClient = client;
  tradingAccountId = account.account_id;
  await client.connect({ token: patInMemory, accountId: account.account_id });
  unsubscribeTrading = client.onMessage(handleTradingMessage);
  patInMemory = null;
  elements.pat.value = "";
  return client;
}

async function recoverOpenContract() {
  const account = selectedAccount();
  if (!account) throw new Error("Choose the account associated with the recorded contract.");
  if (!tradingLedger?.openContract?.contractId) {
    throw new Error("The recorded order has no contract ID. Check Deriv transaction history; automatic recovery is not safe.");
  }
  const contractId = tradingLedger.openContract.contractId;
  const client = await ensureTradingConnection(account);
  const portfolioResponse = await client.request({ portfolio: 1 }, "portfolio");
  const openContracts = portfolioResponse.portfolio?.contracts;
  if (!Array.isArray(openContracts)) throw new Error("Deriv returned an invalid portfolio response.");
  const otherContracts = openContracts.filter((contract) =>
    Number(contract.contract_id) !== contractId);
  if (otherContracts.length) {
    throw new Error(`The account has ${otherContracts.length} other open contract(s). Review them before restarting automation.`);
  }
  await client.subscribeToContract(contractId);
  if (tradingLedger?.openContract?.contractId === contractId) {
    setBotStatus(`Monitoring recorded contract #${contractId}. No new orders will be placed until it settles.`);
  }
  renderTradingState();
}

elements.start.addEventListener("click", () => startMarket(elements.symbol.value.trim()));
elements.stop.addEventListener("click", () => {
  stopBot("Market data stopped; automatic orders paused.");
  if (feed) feed.stop();
  scanner?.stop();
  feed = null;
  render({
    status: "disconnected",
    symbol: elements.symbol.value.trim(),
    ticksLoaded: 0,
    lastQuote: null,
    candles: []
  });
});
elements.symbol.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !elements.start.disabled) startMarket(elements.symbol.value.trim());
});
elements["rescan-markets"].addEventListener("click", () => {
  if (!botRunning && !startAttemptPending) {
    startScanner(Number(elements["expiry-seconds"].value));
  }
});
elements["expiry-seconds"].addEventListener("change", () => {
  if (!botRunning && !startAttemptPending) {
    startScanner(Number(elements["expiry-seconds"].value));
  }
  renderTradingState();
});

elements["validate-pat"].addEventListener("click", async () => {
  const token = elements.pat.value.trim();
  if (token.length < 8 || token.length > 4096) {
    elements["account-status"].textContent = "Enter a valid Deriv PAT with trade scope. The token is not saved.";
    return;
  }
  elements["validate-pat"].disabled = true;
  elements["account-status"].textContent = "Validating PAT and loading Options accounts…";
  try {
    const response = await fetch(`${DERIV_API_BASE_URL}/trading/v1/options/accounts`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Deriv-App-ID": DERIV_APP_ID
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message ?? payload?.message ?? `HTTP ${response.status}`;
      throw new Error(`Account request failed: ${message}`);
    }
    if (!Array.isArray(payload.data)) throw new Error("Deriv returned an unexpected account list.");
    const validAccounts = payload.data.filter((account) =>
      typeof account.account_id === "string" &&
      ["demo", "real"].includes(account.account_type) &&
      typeof account.currency === "string" &&
      account.status === "active");
    accounts = validAccounts;
    patInMemory = token;
    elements.pat.value = "";
    setAccounts(validAccounts);
    elements["account-status"].textContent = validAccounts.length
      ? `${validAccounts.length} active account(s) loaded. PAT is held in this tab's memory only.`
      : "PAT accepted, but Deriv returned no active Options accounts.";
  } catch (error) {
    elements["account-status"].textContent = error instanceof TypeError
      ? "Could not reach Deriv. Check the network and browser connection."
      : error.message;
  } finally {
    elements["validate-pat"].disabled = false;
  }
});

elements.account.addEventListener("change", () => {
  const account = selectedAccount();
  if (account?.account_type === "real") {
    if (!elements["real-confirm"].checked) {
      elements.account.value = lastSelectedAccountId;
      elements["account-status"].textContent = "Check the real-account risk acknowledgement before selecting a Real account.";
      return;
    }
    if (!window.confirm("You selected a REAL account. Bot orders will use real funds after you explicitly start it. Continue?")) {
      elements.account.value = lastSelectedAccountId;
      return;
    }
  }
  lastSelectedAccountId = elements.account.value;
  loadLedgerForAccount(elements.account.value);
  availableBalance = null;
  renderTradingState();
});

elements["real-confirm"].addEventListener("change", () => {
  if (!elements["real-confirm"].checked && selectedAccount()?.account_type === "real" && !botRunning) {
    const demo = accounts.find((account) => account.account_type === "demo");
    if (demo) {
      elements.account.value = demo.account_id;
      lastSelectedAccountId = demo.account_id;
    }
  }
  renderTradingState();
});

elements["start-bot"].addEventListener("click", async () => {
  if (startAttemptPending || botRunning) return;
  startAttemptPending = true;
  const attempt = ++botStartGeneration;
  renderTradingState();
  let lockAcquired = false;
  const account = selectedAccount();
  const config = {
    accountId: account?.account_id,
    accountType: account?.account_type,
    stake: Number(elements.stake.value),
    dailyLossLimit: Number(elements["daily-loss"].value),
    minimumRuleCount: Number(elements["min-rules"].value),
    duration: Number(elements["expiry-seconds"].value),
    durationUnit: "s",
    realAccountConfirmed: elements["real-confirm"].checked,
    currency: account?.currency
  };
  const ensureCurrentAttempt = () => {
    if (attempt !== botStartGeneration) throw new Error("Bot start cancelled.");
  };
  try {
    validateTradingConfig(config);
    if (!latestScannerSnapshot?.ready || latestScannerSnapshot.status !== "streaming") {
      throw new Error("Wait for the live all-market scanner to finish preparing eligible markets.");
    }
    if (!patInMemory && !(tradingClient && tradingAccountId === account.account_id)) {
      throw new Error("Load accounts with a trade-scoped PAT first.");
    }
    if (account.account_type === "real" &&
        !window.confirm(`FINAL CHECK: Start automatic all-market reversal trading on REAL account ${account.account_id} using ${config.stake} ${config.currency} per order, ${config.duration}-second contracts, and ${config.dailyLossLimit} ${config.currency} daily bot-loss stop?`)) {
      return;
    }

    elements["start-bot"].disabled = true;
    setBotStatus(`Connecting to ${account.account_type.toUpperCase()} trading endpoint…`);
    const ledger = loadTradingLedger(localStorage, account.account_id);
    if (ledger.openContract) {
      tradingLedger = ledger;
      renderTradingState();
      if (ledger.openContract.contractId) {
        throw new Error(`Bot contract #${ledger.openContract.contractId} is still recorded as open. Reconnect to monitor it before restarting.`);
      }
      throw new Error("A prior order's result is uncertain. Check Deriv account transactions before clearing the pending-order lock.");
    }

    await acquireAccountLock(account.account_id);
    lockAcquired = true;
    ensureCurrentAttempt();
    if (!latestScannerSnapshot?.ready || latestScannerSnapshot.status !== "streaming") {
      throw new Error("The market scanner disconnected before trading could start.");
    }
    const client = await ensureTradingConnection(account);
    ensureCurrentAttempt();

    const portfolioResponse = await client.request({ portfolio: 1 }, "portfolio");
    ensureCurrentAttempt();
    const openContracts = portfolioResponse.portfolio?.contracts;
    if (!Array.isArray(openContracts)) throw new Error("Deriv returned an invalid portfolio response.");
    if (openContracts.length) {
      throw new Error(`The selected account has ${openContracts.length} open contract(s). Close or settle them before starting the bot.`);
    }
    const balanceResponse = await client.request({ balance: 1, subscribe: 1 }, "balance");
    ensureCurrentAttempt();
    const balance = Number(balanceResponse.balance?.balance);
    const currency = balanceResponse.balance?.currency;
    if (!Number.isFinite(balance) || typeof currency !== "string") {
      throw new Error("Deriv returned an invalid account balance.");
    }
    if (currency !== config.currency) {
      throw new Error(`Account currency changed from ${config.currency} to ${currency}. Reload accounts and check the stake.`);
    }
    if (balance < config.stake) {
      throw new Error(`Account balance is below the configured stake (${config.stake} ${config.currency}).`);
    }
    availableBalance = balance;

    tradingLedger = ledger;
    botConfig = config;
    lastHandledCandleTimestamps.clear();
    botRunning = true;
    startAttemptPending = false;
    setBotStatus(`${account.account_type.toUpperCase()} bot is scanning ${latestScannerSnapshot.readyCount} markets. Orders require a new RSI/Bollinger and VPA-confirmed setup.`);
    renderTradingState();
  } catch (error) {
    botRunning = false;
    if (!tradingLedger?.openContract) {
      unsubscribeTrading?.();
      unsubscribeTrading = null;
      tradingClient?.close();
      tradingClient = null;
      tradingAccountId = null;
    }
    if (lockAcquired && !tradingLedger?.openContract) releaseAccountLock();
    if (attempt === botStartGeneration) setBotStatus(error.message, "error");
  } finally {
    startAttemptPending = false;
    renderTradingState();
  }
});

elements["recover-contract"].addEventListener("click", async () => {
  elements["recover-contract"].disabled = true;
  setBotStatus("Reconnecting to the recorded contract…");
  try {
    await recoverOpenContract();
  } catch (error) {
    setBotStatus(error.message, "error");
  } finally {
    elements["recover-contract"].disabled = false;
    renderTradingState();
  }
});

elements["reconcile-pending"].addEventListener("click", () => {
  if (!tradingLedger?.openContract || tradingLedger.openContract.contractId) return;
  const confirmation = window.confirm(
    "Check Deriv account transactions first. Wait for any possibly purchased contract to settle. This records the actual result you enter and unlocks the bot. Continue?"
  );
  if (!confirmation) return;
  const value = window.prompt(
    `Enter the realized P/L in ${selectedAccount()?.currency ?? "account currency"} (negative for a loss; enter 0 only if Deriv confirms no order was placed):`,
    "0"
  );
  if (value === null) return;
  const realized = Number(value);
  if (!Number.isFinite(realized)) {
    setBotStatus("Enter a valid realized P/L to reconcile the uncertain order.", "error");
    return;
  }
  try {
    tradingLedger = {
      ...tradingLedger,
      realizedPnl: tradingLedger.realizedPnl + realized,
      openContract: null,
      tradeLog: [{
        contractId: "MANUAL",
        direction: tradingLedger.openContract.direction,
        stake: tradingLedger.openContract.stake,
        timestamp: Date.now(),
        result: "RECONCILED",
        profit: realized
      }, ...tradingLedger.tradeLog].slice(0, 100)
    };
    saveTradingLedger(localStorage, tradingLedger);
    ledgerError = null;
    setBotStatus(`Pending order reconciled at ${realized.toFixed(2)} ${selectedAccount()?.currency ?? ""}.`);
    renderTradingState();
  } catch (error) {
    setBotStatus(`Could not save reconciliation: ${error.message}`, "error");
  }
});

elements["stop-bot"].addEventListener("click", () => {
  stopBot(startAttemptPending
    ? "Bot start cancelled. Waiting for the trading connection to close safely."
    : tradingLedger?.openContract
    ? "Stopped. No new orders will be placed; the existing contract will continue until settlement."
    : "Bot stopped. No further orders will be placed.");
});

for (const control of [
  elements.stake,
  elements["expiry-seconds"], elements["daily-loss"], elements["min-rules"]
]) {
  control.addEventListener("input", renderTradingState);
  control.addEventListener("change", renderTradingState);
}

elements.pat.addEventListener("input", () => {
  if (patInMemory && elements.pat.value.trim() !== patInMemory) {
    patInMemory = null;
    accounts = [];
    elements.account.replaceChildren(new Option("Load accounts first", ""));
    elements.account.disabled = true;
    tradingLedger = null;
    elements["account-status"].textContent = "PAT changed; load accounts again before starting.";
    renderTradingState();
  }
});

window.addEventListener("beforeunload", () => {
  if (feed) feed.stop();
  scanner?.stop();
  if (tradingClient) tradingClient.close();
});

elements.account.disabled = true;
setBotStatus(botStatusMessage);
render({
  status: "disconnected",
  symbol: null,
  ticksLoaded: 0,
  lastQuote: null,
  candles: []
});
startMarket(elements.symbol.value.trim());
