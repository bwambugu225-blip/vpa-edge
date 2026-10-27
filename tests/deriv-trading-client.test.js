import test from "node:test";
import assert from "node:assert/strict";
import { DERIV_API_BASE_URL } from "../src/data/deriv-market-feed.js";
import { DerivTradingClient } from "../src/data/deriv-trading-client.js";

class FakeTradingSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeTradingSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  respond(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

async function connectedClient() {
  FakeTradingSocket.instances = [];
  const requests = [];
  const client = new DerivTradingClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: { url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=ephemeral" }
        })
      };
    },
    WebSocketImpl: FakeTradingSocket
  });
  const connection = client.connect({ token: "fake-pat-token", accountId: "CR12345" });
  await new Promise((resolve) => setImmediate(resolve));
  const socket = FakeTradingSocket.instances[0];
  socket.open();
  await connection;
  return { client, socket, requests };
}

test("uses PAT and App-ID to obtain an OTP URL and never sends an authorize message", async () => {
  const { client, socket, requests } = await connectedClient();
  assert.equal(client.isConnected, true);
  assert.equal(requests[0].url, `${DERIV_API_BASE_URL}/trading/v1/options/accounts/CR12345/otp`);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Deriv-App-ID"], "34Nkapu58DUiFIAqSfSky");
  assert.equal(requests[0].options.headers.Authorization, "Bearer fake-pat-token");
  assert.deepEqual(socket.sent, []);
  client.close();
});

test("requests a bounded Rise/Fall proposal and buys only with the selected stake cap", async () => {
  const { client, socket } = await connectedClient();
  const proposalPromise = client.requestRiseFallProposal({
    symbol: "R_100",
    currency: "USD",
    direction: "bullish",
    stake: 0.35,
    duration: 5,
    durationUnit: "s"
  });
  const proposalRequest = socket.sent.at(-1);
  assert.deepEqual({
    proposal: proposalRequest.proposal,
    amount: proposalRequest.amount,
    basis: proposalRequest.basis,
    contract_type: proposalRequest.contract_type,
    currency: proposalRequest.currency,
    duration: proposalRequest.duration,
    duration_unit: proposalRequest.duration_unit,
    underlying_symbol: proposalRequest.underlying_symbol
  }, {
    proposal: 1,
    amount: 0.35,
    basis: "stake",
    contract_type: "CALL",
    currency: "USD",
    duration: 5,
    duration_unit: "s",
    underlying_symbol: "R_100"
  });
  socket.respond({
    msg_type: "proposal",
    req_id: proposalRequest.req_id,
    proposal: { id: "proposal-id-12345678901234567890123456789012", ask_price: 0.35 }
  });
  const proposal = await proposalPromise;

  const buyPromise = client.buyProposal(proposal, 0.35);
  const buyRequest = socket.sent.at(-1);
  assert.deepEqual({ buy: buyRequest.buy, price: buyRequest.price }, {
    buy: proposal.id,
    price: 0.35
  });
  socket.respond({
    msg_type: "buy",
    req_id: buyRequest.req_id,
    buy: { contract_id: 12345, buy_price: 0.35 }
  });
  assert.equal((await buyPromise).contract_id, 12345);
  client.close();
});

test("does not buy when Deriv proposal exceeds configured stake", async () => {
  const { client, socket } = await connectedClient();
  const proposalPromise = client.requestRiseFallProposal({
    symbol: "R_100",
    currency: "USD",
    direction: "bearish",
    stake: 0.35,
    duration: 5,
    durationUnit: "s"
  });
  const request = socket.sent.at(-1);
  assert.equal(request.contract_type, "PUT");
  socket.respond({
    msg_type: "proposal",
    req_id: request.req_id,
    proposal: { id: "proposal-id-12345678901234567890123456789012", ask_price: 0.36 }
  });
  await assert.rejects(proposalPromise, /exceeds the configured stake/);
  assert.equal(socket.sent.length, 1);
  client.close();
});

test("rejects an OTP URL outside Deriv's authenticated trading gateways", async () => {
  FakeTradingSocket.instances = [];
  const client = new DerivTradingClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: { url: "wss://attacker.example/ws?otp=secret" } })
    }),
    WebSocketImpl: FakeTradingSocket
  });
  await assert.rejects(
    client.connect({ token: "fake-pat-token", accountId: "CR12345" }),
    /unexpected authenticated WebSocket URL/
  );
  assert.equal(FakeTradingSocket.instances.length, 0);
});
