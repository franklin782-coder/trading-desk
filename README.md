# AI Trading Desk

**Live:** https://jack10147.github.io/trading-desk/ · **BNB MEMES:** https://jack10147.github.io/trading-desk/memes.html

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

## Search
- **Main desk:** search any Hyperliquid perp (autocomplete from `meta`/`metaAndAssetCtxs`). Picking a coin subscribes its WS feeds, loads `candleSnapshot`, opens it in the big chart, and queues it for the bots to discuss.
- **BNB MEMES:** DexScreener `/latest/dex/search` filtered to BSC. You can also paste a token or pair address (`/tokens/v1/bsc/{addr}` with a `/latest/dex/pairs/bsc/{pair}` fallback). Picking a result opens the DexScreener embed and stats, adds the token to the table, and the bots inspect it next.
- Keyboard: `/` focuses search, ↑/↓ moves through results, Enter opens one, Esc closes the dropdown.

## BNB MEMES page (`memes.html`)
- Discovery: about 40 DexScreener searches (well-known BSC meme tickers plus generic meme terms), plus BSC tokens from `token-boosts/top`, `token-boosts/latest` and `token-profiles/latest`, combined via `tokens/v1/bsc`. Each token keeps its most liquid pair with a WBNB/USDT/USD1/BUSD/USDC quote.
- Junk filter: liquidity under $40K, 24h volume under $10K, non-meme tokens (stables, wrapped/pegged majors, DeFi/infra), and odd quote pairs. Every token gets a 0–100 risk score from liquidity, liq/mcap, age, FDV/MC, sell pressure, churn, socials and copycat tickers.
- Refresh: the top ~40 tokens every 30s, hot/focused pairs every 6s, discovery every 6 min. 1m candles come from GeckoTerminal, throttled to about 1 request per 10s.
- Focus chart: DexScreener embed (`?embed=1&theme=dark&info=0…`), with a "DESK 1m" toggle for our own candle chart. A wall of 6 live mini charts shows what the bots have opened.
- Bots: meme personas (momentum, dip hunter, rug guard, degen flow, contrarian), all using real data. Ideas are PAPER BUY only, confidence is capped at LOW/MEDIUM, stops are wide, and ATLAS vetoes HIGH/EXTREME risk.
