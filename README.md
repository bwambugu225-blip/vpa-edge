# VPA Edge reversal website

VPA Edge is a standalone website for watching Deriv five-second candles and
reading heuristic, key-level Volume Price Analysis (VPA) reversal signals.

The market display is live-feed-only. It uses Deriv's public tick WebSocket and
does not provide simulated prices, replay, or generated candles. On disconnect,
the site reports connection status and retries against Deriv rather than
substituting sample data.

## Run locally

Requires Node.js 18 or newer:

```text
npm.cmd start
```

Open <http://127.0.0.1:5173>. The public market feed connects automatically
using `R_100`; change the underlying and reconnect with **Connect market** if
you want a different symbol. The browser requests the latest 500 ticks from
Deriv's public WebSocket API and aggregates them into locally generated
five-second OHLC candles. The live chart, tick activity, VPA patterns, and
pre-trade checklist update as new candles close.

The public market feed and VPA dashboard need no account login or token. To
place live orders, a trade-scoped PAT is required to load accounts and
authenticate the trading connection. The PAT stays in page memory only and is
cleared after the authenticated WebSocket is connected. The bot defaults to a
demo account and 0.35 stake in account currency. It takes reversal-only
signals with at least two matching patterns at support or resistance, skips
conflicting evidence, and maps rule count plus relative activity/spread to an
expiry of one to five five-second candles (5–25 seconds). That mapping is a
heuristic, not a measured win probability. There is no hourly order cap; the
bot waits for each contract to settle before placing another order and
continues only while it receives new qualifying reversal signals. You must set
a daily bot-loss stop before starting. Real-account selection requires an
acknowledgement and an additional confirmation.

Starting the bot authorizes automatic Rise/Fall contracts on new completed-bar
VPA signals. The stake is capped by the requested amount; no martingale or
retry-after-uncertain-buy behavior is used. **Stop new orders** prevents future
bot entries but does not cancel an already purchased contract. The daily-loss
ledger tracks this bot's realized contracts in the browser profile and cannot
include manual trades or other apps trading the same account. Do not rely on a
browser-only tool as a guaranteed financial loss limit.

Deriv's public price ticks do not represent centralized traded volume. VPA's
volume comparisons therefore use the number of ticks per candle as an activity
proxy, not institutional or exchange volume. VPA results are heuristic and
not guaranteed predictions or trade instructions.
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
