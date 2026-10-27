import { DERIV_API_BASE_URL } from "./deriv-market-feed.js";

const DERIV_APP_ID = "34Nkapu58DUiFIAqSfSky";

export class DerivTradingClient {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    WebSocketImpl = globalThis.WebSocket
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
    if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is unavailable");
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.pending = new Map();
    this.listeners = new Set();
    this.nextRequestId = 1;
    this.closed = false;
  }

  get isConnected() {
    return this.socket?.readyState === 1;
  }

  async connect({ token, accountId }) {
    if (typeof token !== "string" || token.trim().length < 8) {
      throw new TypeError("Enter a valid Deriv PAT with trade scope.");
    }
    if (typeof accountId !== "string" || !/^[\w-]{2,64}$/.test(accountId)) {
      throw new TypeError("Choose a valid Deriv account.");
    }

    const response = await this.fetchImpl(
      `${DERIV_API_BASE_URL}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "Deriv-App-ID": DERIV_APP_ID,
          "Content-Type": "application/json"
        }
      }
    );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Deriv authentication returned invalid JSON (${response.status}).`);
    }
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message ?? payload?.message;
      throw new Error(message
        ? `Deriv authentication failed (${response.status}): ${message}`
        : `Deriv authentication failed with HTTP ${response.status}.`);
    }

    const url = new URL(payload?.data?.url ?? "");
    if (url.protocol !== "wss:" || url.hostname !== "api.derivws.com" ||
        !/^\/trading\/v1\/options\/ws\/(demo|real)$/.test(url.pathname)) {
      throw new Error("Deriv returned an unexpected authenticated WebSocket URL.");
    }
    await this.openSocket(url.href);
  }

  openSocket(url) {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new this.WebSocketImpl(url);
      } catch (error) {
        reject(new Error(`Could not open Deriv trading connection: ${error.message}`));
        return;
      }
      this.socket = socket;
      const timeout = setTimeout(() => {
        if (socket.readyState === 1) return;
        this.close();
        reject(new Error("Timed out connecting to Deriv trading WebSocket."));
      }, 12000);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onerror = () => {
        if (socket.readyState !== 1) {
          clearTimeout(timeout);
          reject(new Error("Deriv trading WebSocket connection failed."));
        }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (!this.closed) {
          this.rejectPending(new Error("Deriv trading connection closed."));
          this.notify({ type: "disconnect" });
        }
      };
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.rejectPending(new Error("Deriv sent an invalid trading response."));
      return;
    }

    if (message.error) {
      const error = new Error(String(message.error.message ?? "Deriv rejected the request."));
      error.derivRejected = true;
      const pending = this.pending.get(message.req_id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.req_id);
        pending.reject(error);
      } else {
        this.notify({ type: "error", error: error.message });
      }
      return;
    }

    const pending = this.pending.get(message.req_id);
    if (pending && message.msg_type === pending.expectedType) {
      clearTimeout(pending.timeout);
      this.pending.delete(message.req_id);
      pending.resolve(message);
    }
    this.notify(message);
  }

  notify(message) {
    for (const listener of this.listeners) listener(message);
  }

  onMessage(listener) {
    if (typeof listener !== "function") throw new TypeError("Listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(payload, expectedType, timeoutMs = 12000) {
    if (!this.socket || this.socket.readyState !== 1) {
      return Promise.reject(new Error("Deriv trading connection is not open."));
    }
    const reqId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Timed out waiting for Deriv ${expectedType} response.`));
      }, timeoutMs);
      this.pending.set(reqId, { expectedType, resolve, reject, timeout });
      try {
        this.socket.send(JSON.stringify({ ...payload, req_id: reqId }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(reqId);
        reject(new Error(`Could not send Deriv ${expectedType} request: ${error.message}`));
      }
    });
  }

  async requestRiseFallProposal({
    symbol,
    currency,
    direction,
    stake,
    duration,
    durationUnit
  }) {
    if (!["bullish", "bearish"].includes(direction)) {
      throw new TypeError("A directional VPA signal is required before ordering.");
    }
    if (!Number.isFinite(stake) || stake <= 0 ||
        !Number.isSafeInteger(duration) || duration <= 0 ||
        !["t", "s", "m"].includes(durationUnit)) {
      throw new TypeError("Stake and contract duration must be valid positive values.");
    }
    if (!/^\w{2,30}$/.test(symbol) || !/^[A-Za-z0-9]{2,20}$/.test(currency)) {
      throw new TypeError("Symbol or account currency is invalid.");
    }

    const proposalResponse = await this.request({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type: direction === "bullish" ? "CALL" : "PUT",
      currency,
      duration,
      duration_unit: durationUnit,
      underlying_symbol: symbol
    }, "proposal");
    const proposal = proposalResponse.proposal;
    const askPrice = Number(proposal?.ask_price);
    if (typeof proposal?.id !== "string" || !/^[\w-]{32,128}$/.test(proposal.id) ||
        !Number.isFinite(askPrice) || askPrice <= 0) {
      throw new Error("Deriv returned an invalid price proposal; no order was sent.");
    }
    if (askPrice > stake) {
      throw new Error("The quoted price exceeds the configured stake; no order was sent.");
    }
    return proposal;
  }

  async buyProposal(proposal, maximumPrice) {
    if (typeof proposal?.id !== "string" || !/^[\w-]{32,128}$/.test(proposal.id) ||
        !Number.isFinite(maximumPrice) || maximumPrice <= 0) {
      throw new TypeError("A valid proposal and maximum price are required.");
    }
    const buyResponse = await this.request({
      buy: proposal.id,
      price: maximumPrice
    }, "buy");
    if (!buyResponse.buy || !Number.isSafeInteger(Number(buyResponse.buy.contract_id))) {
      throw new Error("Deriv did not confirm the contract purchase.");
    }
    return buyResponse.buy;
  }

  async placeRiseFall(config) {
    const proposal = await this.requestRiseFallProposal(config);
    return this.buyProposal(proposal, config.stake);
  }

  subscribeToContract(contractId) {
    if (!Number.isSafeInteger(contractId) || contractId <= 0) {
      return Promise.reject(new TypeError("Invalid contract ID."));
    }
    return this.request({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1
    }, "proposal_open_contract");
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.closed = true;
    this.rejectPending(new Error("Deriv trading connection stopped."));
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close();
  }
}
