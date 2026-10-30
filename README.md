# VPA Edge reversal website

VPA Edge is a standalone website for watching live Deriv markets and scanning
for heuristic RSI/Bollinger and key-level Volume Price Analysis (VPA) reversal
setups.

The market display is live-feed-only. It uses Deriv's public tick WebSocket and
does not provide simulated prices, replay, or generated candles. On disconnect,
the site reports connection status and retries against Deriv rather than
substituting sample data.

## Run locally

Requires Node.js 18 or newer:

```text
npm.cmd start
```

Open <http://127.0.0.1:5173>. Market data and the scanner start automatically.
The market selector offers **All eligible markets** or an individual eligible
symbol; the chart follows the selected symbol (or a representative live market
in all-markets mode). The scanner discovers open, unsuspended markets, checks
that both CALL and PUT contracts support 15 seconds, imports up to 500 ticks
per eligible symbol, and streams them over one public WebSocket. Chart and
scanner feeds build 15-second OHLC candles. If a market request fails, bot
start stays disabled until market discovery completes successfully.
Both public feeds reconnect automatically with increasing backoff after
connection loss, retain the displayed chart during recovery, and refresh tick
history when the socket returns. Bringing a suspended tab back online triggers
a stale-connection check; no page reload is needed.

The public market feed and VPA dashboard need no account login or token. To
place live orders, a trade-scoped PAT is required to load accounts and
authenticate the trading connection. The PAT stays in page memory only and is
cleared after the authenticated WebSocket is connected. The bot defaults to a
demo account, 0.35 stake in account currency, 15-second candles and 15-second
contracts. A setup requires a completed candle to reject a Bollinger Band after RSI enters
the oversold/overbought zone, plus at least two matching VPA reversal patterns
at support or resistance. Conflicting signals are skipped. In all-markets mode,
the scanner considers the first newly qualifying setup after the bot starts;
choosing a symbol restricts entries to that market. These conditions are
heuristics, not measured win probabilities.
There is no hourly order cap; the bot waits for each contract to settle before
placing another order and continues only while it receives new qualifying
signals. The daily bot-loss stop defaults to 10 account-currency units and is
editable. Real-account selection requires an acknowledgement and an additional
confirmation.

Starting the bot authorizes automatic Rise/Fall contracts on new completed-bar
RSI/Bollinger and VPA-confirmed signals. The stake is capped by the requested
amount; no martingale or retry-after-uncertain-buy behavior is used. The single
**Start bot / Stop bot** toggle remains available while running and offers
**Cancel start** during connection setup. Stopping prevents future entries but
does not cancel an already purchased contract. The daily-loss ledger tracks this bot's realized contracts in the
browser profile and cannot include manual trades or other apps trading the
same account. Do not rely on a browser-only tool as a guaranteed financial
loss limit.

Deriv's public price ticks do not represent centralized traded volume. VPA's
volume comparisons therefore use the number of ticks per candle as an activity
proxy, not institutional or exchange volume. The RSI/Bollinger and VPA
combination is an unvalidated heuristic, not a prediction or trade instruction.
No configuration can guarantee a high win rate or near-zero losses; this
strategy has not been validated as profitable through independent live or
out-of-sample results.

Run the test suite with:

```text
npm.cmd test
```

The site is static and can be hosted on GitHub Pages without a build step. Its
asset links are relative so the site also works when served from a repository
subpath.

See [INTEGRATION.md](./INTEGRATION.md) for the data-flow and privacy details.
