# VPA Edge website

VPA Edge is a standalone website for watching Deriv five-second candles and
reading heuristic Volume Price Analysis (VPA) signals.

The market display is live-feed-only. It uses Deriv's public tick WebSocket and
does not provide simulated prices, replay, or generated candles. On disconnect,
the site reports connection status and retries against Deriv rather than
substituting sample data.

## Run locally

Requires Node.js 18 or newer:

```text
npm.cmd start
```

Open <http://127.0.0.1:5173>, enter a Deriv underlying symbol such as `R_100`,
and select **Connect market**. The browser requests the latest 500 ticks from
Deriv's public WebSocket API and aggregates them into locally generated
five-second OHLC candles. The live chart, tick activity, VPA patterns, and
pre-trade checklist update as new candles close.

The public market feed needs no token. A trade-scoped PAT is required to load
accounts and authenticate the trading connection. The PAT stays in page memory
only and is cleared after the authenticated WebSocket is connected. The bot
defaults to a demo account, 0.35 stake in account currency, 5-second contract
duration, one order per rolling hour, and one matching VPA rule. You must set a
daily bot-loss stop before starting. Real-account selection requires an
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

Run the test suite with:

```text
npm.cmd test
```

The site is static and can be hosted on GitHub Pages without a build step. Its
asset links are relative so the site also works when served from a repository
subpath.

See [INTEGRATION.md](./INTEGRATION.md) for the data-flow and privacy details.
