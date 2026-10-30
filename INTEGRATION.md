# Website and Deriv data integration

VPA Edge is served as a regular static JavaScript website by `server.js`. No
extension runtime, content script, or Chrome extension storage is required.
It is live-data-only: there is no simulation, replay, mock feed, or generated
market data fallback.

## Market data

- The browser connects to Deriv's public endpoint:
  `wss://api.derivws.com/trading/v1/options/ws/public`.
- The chart requests `ticks_history` with `count: 500`, `style: "ticks"`, and
  `subscribe: 1` for the selected chart symbol.
- A second public connection requests open, unsuspended symbols that support
  CALL/PUT, checks `contracts_for` for 15-second contracts, then seeds each
  eligible market with up to 500 ticks and streams its updates. Scanner
  requests are paced to stay within Deriv's documented WebSocket request budget.
- Both public sockets reconnect automatically with increasing delay after
  disconnects, detect stalled streams, and refresh market history without
  requiring a page reload. The chart keeps its last candles while reconnecting.
  Returning online or restoring a backgrounded tab triggers a connection check.
- The website builds 15-second OHLC candles locally from tick epochs and quotes.
  Candle `volume` is the count of ticks and is identified as a tick activity
  proxy, never centralized traded volume.
- Both the VPA rules and the RSI(14)/Bollinger(20, 2 standard deviations)
  indicator use completed candles only. A reversal requires a band rejection
  following an oversold/overbought RSI reading plus VPA evidence at a key level.
- The selector is populated automatically with all eligible markets and
  supports all-markets mode or a single-market filter. The bot trades the first
  newly qualified scanner setup after it starts in all-markets mode, or
  restricts entries to the selected symbol. It only uses symbols where public
  `contracts_for` reports both CALL and PUT for 15 seconds. A
  reconnect obtains fresh history; the bot pauses on scanner disconnection or
  an incomplete scan. **Refresh scanner** retries market discovery.

## Account authentication and orders

The browser sends a user-entered trade-scoped PAT to
`GET https://api.derivws.com/trading/v1/options/accounts` with the required
`Deriv-App-ID`, then calls the documented account OTP endpoint and connects to
the returned authenticated trading WebSocket. The PAT stays in page memory
only and is cleared after the authenticated socket opens. The one-time
WebSocket URL is never displayed or persisted.

Starting the bot is opt-in. It defaults to a demo account, 0.35 account
currency stake, 15-second candles and contracts, and a daily bot-loss limit of
10 account-currency units. Real accounts require a risk acknowledgement and a browser
confirmation. Before enabling the bot, the site checks that the all-market
scanner is ready, the account has no open portfolio contracts, and the balance
covers the stake.

The bot requires a completed-bar Bollinger Band rejection with RSI turning out
of an oversold/overbought reading, at least two matching VPA patterns at the
relevant support/resistance level by default, and no conflicting directional
evidence. The 15-second candle and contract intervals are fixed. This is a deterministic,
unvalidated heuristic, not a probability or measured performance estimate.
The bot requests a CALL (Rise) or PUT (Fall) proposal for the symbol that
qualified, caps the buy price at the configured stake, and monitors settlement.
There is no hourly trade cap, but it will not open another bot contract until
the current one settles. An uncertain buy request is never retried
automatically; the bot retains a risk lock until the user checks the Deriv
account and reconciles the result.

The browser ledger tracks this bot's realized results. It cannot include
manual trades or other software on the same account and is not a guaranteed
server-side loss limit. The single **Start bot / Stop bot** toggle remains
available while running and offers **Cancel start** during connection setup.
Stopping prevents future entries but does not cancel an already purchased contract.

## Privacy and limitations

- Tick data stays in browser memory and is not posted to another service.
- PAT data is sent only to Deriv's documented account and OTP endpoints.
- Authenticated WebSocket proposals, purchases, and contract monitoring are
  sent only after the user starts the bot.
- Tick counts are an activity proxy and must not be interpreted as actual
  traded volume or institutional order flow.
- RSI/Bollinger and VPA reversal signals are heuristic, not validated
  probabilities or guaranteed predictions; near-zero losses cannot be promised.

## Verify

1. Run `npm.cmd start` and open <http://127.0.0.1:5173>.
2. Confirm markets load automatically, 500 ticks are requested, and the chart
   begins showing 15-second candles.
3. Choose **All eligible markets** or a specific market in the selector.
4. Load a trade-scoped PAT and select the demo account first.
5. Confirm the account currency and stake, adjust the default daily loss limit
   if needed, then select **Start bot**. Use the same toggle to stop or cancel.
6. Run `npm.cmd test` to verify Deriv requests, scanner filtering, indicator
   confirmation, candle aggregation, trading controls, and the risk ledger.
