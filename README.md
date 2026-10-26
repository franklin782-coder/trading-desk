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

Tests: `node tests/risk.test.js`

Risk/journal concepts adapted from [galleonlabs/hypergrok-trading-desk](https://github.com/galleonlabs/hypergrok-trading-desk) (MIT).

> ⚠️ Everything is **paper/hypothetical**. These are not real trades and not financial advice.

Plain static HTML/CSS/JS with no build step. `js/engine.js` holds the pure indicator and bot logic (it also runs in Node), and `js/app.js` holds the UI, data feed and orchestration.

## Search
- **Main desk:** search any Hyperliquid perp (autocomplete from `meta`/`metaAndAssetCtxs`). Picking a coin subscribes its WS feeds, loads `candleSnapshot`, opens it in the big chart, and queues it for the bots to discuss.
- Keyboard: `/` focuses search, ↑/↓ moves through results, Enter opens one, Esc closes the dropdown.
