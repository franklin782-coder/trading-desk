# AI Trading Desk

**Live:** https://franklin782-coder.github.io/trading-desk/

An animated, terminal-style dashboard where five rule-based bot personas watch **real, live crypto charts** and debate trade ideas.

- **Live data** comes straight from the browser to [Hyperliquid's public API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api), with no key and no backend:
  - WebSocket `wss://api.hyperliquid.xyz/ws`: `bbo` (best bid/offer, mid price several times per second), `trades` (taker flow and volume), `candle` 1m, and `activeAssetCtx` (24h change, funding, volume)
  - REST `https://api.hyperliquid.xyz/info`: `candleSnapshot` (4h of 1m history) and `metaAndAssetCtxs`, with `allMids` polling as a fallback when the WS drops
- **Coins:** BTC, ETH, SOL, HYPE, DOGE, XRP (perps)
- **Charts:** [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) v4.2 (CDN): a focus chart with 1m/1s candles, EMA9/21 and volume, plus six 1-second live minis
- **Bots:** NOVA (momentum), LUNA (mean reversion), ATLAS (risk manager), ECHO (flow & sentiment), VEX (contrarian). Each one computes real indicators (RSI14, EMA9/21 crosses, Bollinger z, ATR, σ of returns, volume spikes, taker-flow imbalance, funding) and turns them into chat messages through personality templates.
- **Ideas for you:** when the bots reach consensus and ATLAS doesn't veto, the desk publishes an idea with entry, stop (1.5×ATR), target (2R), reasoning, and which bots agreed. Each idea is tracked live.
- **Ops widgets:** a desk-cycle pipeline (SCAN → ANALYZE → DEBATE → CONSENSUS → IDEA), a bot network graph with animated particle links, a session bus showing bot-to-bot handoff packets, a bot status panel (state and conviction), a signal radar (momentum, trend, volatility, volume, flow, RSI), a coin × timeframe % change heatmap, and a latest-decision box (confidence, compute time, feed lag). All of it is computed from live data.
- **Paper book:** each trading bot has its own hypothetical $10k account (persisted in `localStorage`), marked to live prices.
- **Risk module (`js/risk.js`, pure + unit-tested):** size = 1% of *current* equity ÷ worst-case loss per unit (stop distance + slippage + entry/exit fees). Never depends on the last trade. Hard ceilings in code (2% risk/trade, 6% open risk, 3x leverage, 5% daily loss, pause after ≤5 losses) — the on-page settings can only tighten them. A bot whose last-20-trade expectancy is negative goes on *probation* (half risk) until it recovers.
- **ATLAS circuit breakers** (shown live with status): daily loss cap, loss-streak pause, liquidity (Hyperliquid `l2Book` depth within ±0.5% of mid), stale feed (no WS data > 10 s). Any tripped rule blocks new entries and ideas; the veto log shows which rule fired.
- **Journal & lessons:** every closed paper trade is appended to a local journal with R result, fees, slippage estimate, separate *process* and *outcome* grades and a one-line lesson. Per-bot stats (win rate, avg R, expectancy, last-20 expectancy, profit factor, equity curve). Export as JSON.
- **Tickets:** each desk idea is numbered `TD-YYYYMMDD-NN` with exact entry, stop, target and size per $10k.

Tests: `for f in tests/*.test.js; do node $f; done`

Risk/journal concepts adapted from [galleonlabs/hypergrok-trading-desk](https://github.com/galleonlabs/hypergrok-trading-desk) (MIT).

> ⚠️ Everything is **paper/hypothetical**. These are not real trades and not financial advice.

Plain static HTML/CSS/JS with no build step. `js/engine.js` holds the pure indicator and bot logic (it also runs in Node), and `js/app.js` holds the UI, data feed and orchestration.

## Search
- **Main desk:** search any Hyperliquid perp (autocomplete from `meta`/`metaAndAssetCtxs`). Picking a coin subscribes its WS feeds, loads `candleSnapshot`, opens it in the big chart, and queues it for the bots to discuss.
- Keyboard: `/` focuses search, ↑/↓ moves through results, Enter opens one, Esc closes the dropdown.

## Pages

- **◆ MAIN DESK** (`index.html`) — BTC, ETH, SOL, HYPE, DOGE, XRP (+ any searched Hyperliquid perp). Tickets `TD-YYYYMMDD-NN`, storage `td.*`.
- **▲ STOCKS** (`stocks.html`) — the same five bots (NOVA, LUNA, ATLAS, ECHO, VEX), same risk module, circuit breakers, journal and lessons, paper-trading **Hyperliquid HIP-3 stock perps** on builder dex `xyz` (`xyz:NVDA` etc., public API, no keys, 24/7).
  Watchlist: NVDA, AMZN, GOOGL, AMD, AVGO, MU, TSLA, MSFT, META, CRWV, IREN, PLTR, COIN, ANT (Anthropic pre-IPO perp), SP500, XYZ100 (Nasdaq-100). Search finds any other `xyz` stock perp (AAPL, NFLX, ORCL…).
  Tickets `TS-YYYYMMDD-NN`; separate paper book and journal (`ts.*` in localStorage, every journal row carries `market: "stocks"`), so crypto and stock stats never mix.
  A badge shows the US session (OPEN / PRE-MARKET / AFTER-HOURS / CLOSED, New York time, holidays not modelled). Outside regular hours perps still trade, but prices are set by perp traders only.
- One shared `js/app.js` drives both pages; `stocks.html` sets `window.DESK_CFG` (dex, coins, ticket prefix, storage prefix). `js/market-hours.js` is pure and unit-tested.
- The old BNB Memes page has been removed.

## Capital split & portfolio (80/20)

- Each trading bot (NOVA, LUNA, ECHO, VEX) owns **$10,000 paper**: **$8,000 crypto book** (main desk, 80%) + **$2,000 stocks book** (stocks desk, 20%). ATLAS is the risk officer and has no book. Each desk sizes 1% risk off its own book (`Risk.bookStart(market)`, tested in `tests/allocation.test.js`). Old `*.book.v2` $10k books are reset once to the new split (journal kept).
- Main desk universe: majors **BTC, ETH, SOL, BNB** always, plus the top 6 other Hyperliquid perps by 24h volume picked at load (`Risk.pickTopByVolume`); the ATLAS liquidity rule still applies.
- **PORTFOLIO panel** (`js/portfolio.js`, on both pages): per-bot total equity, crypto vs stocks book, realized/unrealized P&L, % change, combined total; every open position (ID, bot, asset, side, size in units and $, entry, now, stop, target, unrealized $ and %, opened time); recent closed trades. Click a row to open that chart (switches desk if needed). Every bot position now gets a ticket ID (`TD-…` / `TS-…`).
