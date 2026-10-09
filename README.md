# AI Trading Desk

**Live:** https://jack10147.github.io/trading-desk/

An animated, terminal-style dashboard where five rule-based bot personas watch **real, live crypto charts** and debate trade ideas.

- **Live data** comes straight from the browser to [Hyperliquid's public API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api), with no key and no backend:
  - WebSocket `wss://api.hyperliquid.xyz/ws`: `bbo` (best bid/offer, mid price several times per second), `trades` (taker flow and volume), `candle` 1m, and `activeAssetCtx` (24h change, funding, volume)
  - REST `https://api.hyperliquid.xyz/info`: `candleSnapshot` (4h of 1m history) and `metaAndAssetCtxs`, with `allMids` polling as a fallback when the WS drops
- **Coins:** BTC, ETH, SOL, HYPE, DOGE, XRP (perps)
- **Charts:** [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) v4.2 (CDN): a focus chart with 1m/1s candles, EMA9/21 and volume, plus six 1-second live minis
- **Bots:** NOVA (momentum), LUNA (mean reversion), ATLAS (risk manager), ECHO (flow & sentiment), VEX (contrarian). Each one computes real indicators (RSI14, EMA9/21 crosses, Bollinger z, ATR, σ of returns, volume spikes, taker-flow imbalance, funding) and turns them into chat messages through personality templates.
- **Ideas for you:** when the bots reach consensus and ATLAS doesn't veto, the desk publishes an idea with entry, stop (1.5×ATR), target (2R), reasoning, and which bots agreed. Each idea is tracked live.
- **Ops widgets:** a desk-cycle pipeline (SCAN → ANALYZE → DEBATE → CONSENSUS → IDEA), a bot network graph with animated particle links, a session bus showing bot-to-bot handoff packets, a bot status panel (state and conviction), a signal radar (momentum, trend, volatility, volume, flow, RSI), a coin × timeframe % change heatmap, and a latest-decision box (confidence, compute time, feed lag). All of it is computed from live data.
- **Paper book:** hypothetical $10k positions per bot, marked to live prices.

> ⚠️ Everything is **paper/hypothetical**. These are not real trades and not financial advice.

Plain static HTML/CSS/JS with no build step. `js/engine.js` holds the pure indicator and bot logic (it also runs in Node), and `js/app.js` holds the UI, data feed and orchestration.
