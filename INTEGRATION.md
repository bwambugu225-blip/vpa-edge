# Website and Deriv data integration

VPA Edge is served as a regular static JavaScript website by `server.js`. No
extension runtime, content script, or Chrome extension storage is required.
It is live-data-only: there is no simulation, replay, mock feed, or generated
market data fallback.

## Market data

- The browser connects to Deriv's public endpoint:
  `wss://api.derivws.com/trading/v1/options/ws/public`.
- It requests `ticks_history` with `count: 500`, `style: "ticks"`, and
  `subscribe: 1`.
- The website builds 5-second OHLC candles locally from tick epochs and quotes.
  Candle `volume` is the count of ticks and is identified as a tick activity
  proxy, never centralized traded volume.
- VPA reads completed candles only; live, incomplete candles are charted but
  not used for directional analysis. A reconnect obtains a fresh history.

## Account authentication and orders

The browser sends a user-entered trade-scoped PAT to
`GET https://api.derivws.com/trading/v1/options/accounts` with the required
`Deriv-App-ID`, then calls the documented account OTP endpoint and connects to
the returned authenticated trading WebSocket. The PAT stays in page memory
only and is cleared after the authenticated socket opens. The one-time
WebSocket URL is never displayed or persisted.

Starting the bot is opt-in. It defaults to a demo account, 0.35 account
currency stake, 5-second contract duration, one order per rolling hour, and
one same-direction VPA rule. A positive daily bot-loss limit is mandatory.
Real accounts require a risk acknowledgement and a browser confirmation.
Before enabling the bot, the site checks that the market is live, the account
has no open portfolio contracts, the balance covers the stake, and a valid
VPA baseline exists.

For each new qualifying closed candle, the bot requests a CALL (Rise) or PUT
(Fall) proposal, caps the buy price at the configured stake, reserves the
hourly-order slot before submitting, and monitors settlement. An uncertain
buy request is never retried automatically; the bot retains a risk lock until
the user checks the Deriv account and reconciles the result.

The browser ledger tracks this bot's realized results. It cannot include
manual trades or other software on the same account and is not a guaranteed
server-side loss limit. **Stop new orders** prevents future bot entries but
does not cancel an already purchased contract.

## Privacy and limitations

- Tick data stays in browser memory and is not posted to another service.
- PAT data is sent only to Deriv's documented account and OTP endpoints.
- Authenticated WebSocket proposals, purchases, and contract monitoring are
  sent only after the user starts the bot.
- Tick counts are an activity proxy and must not be interpreted as actual
  traded volume or institutional order flow.
- Rise/Fall signals are heuristic, not guaranteed predictions.

## Verify

1. Run `npm.cmd start` and open <http://127.0.0.1:5173>.
2. Connect a symbol such as `R_100`; confirm tick history loads and the chart
   begins showing five-second candles.
3. Load a trade-scoped PAT and select the demo account first.
4. Set the required daily loss cap, confirm the account currency, stake,
   duration, and hourly order cap, then select **Start bot**.
5. Run `npm.cmd test` to verify the Deriv request, candle aggregation, VPA
   rules, trading controls, and risk ledger.
