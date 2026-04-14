# 왓서ㅂI Stock Price API

Cloudflare Worker that fetches live stock data from Yahoo Finance and computes technical indicators.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check |
| `GET /price/AAPL` | Single stock with live price + indicators |
| `GET /batch/AAPL,MSFT,TSLA` | Multiple stocks at once |

## Computed Indicators
- SMA (20-day, 50-day)
- MACD (12/26/9)
- RSI (14-period)
- Volume trend
- Short-term signal

## Deploy
Connected to Cloudflare Workers via GitHub integration. Auto-deploys on push to `main`.
