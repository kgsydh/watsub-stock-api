// ═══════════════════════════════════════════════════════════════
// 왓서ㅂI Stock Price API — Cloudflare Worker
// Fetches live stock data from Yahoo Finance, computes indicators
// Deploy free at workers.cloudflare.com (100K req/day free)
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(request) {
    // CORS headers for artifact access
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /price/AAPL — single stock
    // GET /batch/AAPL,MSFT,TSLA — multiple stocks
    if (path.startsWith("/price/")) {
      const symbol = path.replace("/price/", "").toUpperCase();
      const data = await fetchStock(symbol);
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    if (path.startsWith("/batch/")) {
      const symbols = path.replace("/batch/", "").toUpperCase().split(",");
      const results = {};
      // Fetch in parallel, max 10 at a time
      const batches = [];
      for (let i = 0; i < symbols.length; i += 10) {
        batches.push(symbols.slice(i, i + 10));
      }
      for (const batch of batches) {
        const promises = batch.map(async (sym) => {
          results[sym] = await fetchStock(sym);
        });
        await Promise.all(promises);
      }
      return new Response(JSON.stringify(results), { headers: corsHeaders });
    }

    // Health check
    return new Response(
      JSON.stringify({
        status: "ok",
        usage: "GET /price/AAPL or GET /batch/AAPL,MSFT,TSLA",
        version: "1.0",
      }),
      { headers: corsHeaders }
    );
  },
};

// ─── Fetch stock data from Yahoo Finance ───
async function fetchStock(symbol) {
  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d&includePrePost=false`;
    const resp = await fetch(chartUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!resp.ok) throw new Error(`Yahoo returned ${resp.status}`);
    const json = await resp.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No data");

    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    if (!quotes?.close) throw new Error("No price data");

    // Clean arrays (remove nulls)
    const closes = [],
      volumes = [];
    for (let i = 0; i < quotes.close.length; i++) {
      if (quotes.close[i] != null) {
        closes.push(quotes.close[i]);
        volumes.push(quotes.volume[i] || 0);
      }
    }

    const price =
      meta.regularMarketPrice || closes[closes.length - 1];
    const prevClose =
      meta.chartPreviousClose || closes[closes.length - 2] || price;
    const change = (((price - prevClose) / prevClose) * 100).toFixed(2);

    // Compute indicators
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, 50);
    const macd = calcMACD(closes);
    const rsi14 = calcRSI(closes, 14);

    // Volume trend
    const recentVol =
      volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const priorVol =
      volumes.slice(-25, -5).reduce((a, b) => a + b, 0) / 20;
    const vol =
      recentVol > priorVol * 1.15
        ? "increasing"
        : recentVol < priorVol * 0.85
        ? "decreasing"
        : "stable";

    // Short-term signal
    const p5d =
      closes.length >= 6
        ? ((price - closes[closes.length - 6]) /
            closes[closes.length - 6]) *
          100
        : 0;
    const p1m =
      closes.length >= 22
        ? ((price - closes[closes.length - 22]) /
            closes[closes.length - 22]) *
          100
        : 0;
    const stSig =
      p5d > 2 ? "bullish" : p5d < -2 ? "bearish" : "neutral";
    const trend =
      p1m > 5 ? "uptrend" : p1m < -5 ? "downtrend" : "sideways";

    return {
      ticker: symbol,
      name: meta.shortName || meta.longName || symbol,
      price: round(price),
      prevClose: round(prevClose),
      change: parseFloat(change),
      ma20: round(ma20),
      ma50: round(ma50),
      priceAboveMa20: price > ma20,
      priceAboveMa50: price > ma50,
      ma20AboveMa50: ma20 > ma50,
      macd: {
        value: round(macd.value),
        signal: round(macd.signal),
        histogram: round(macd.histogram),
        aboveZero: macd.value > 0,
      },
      rsi14: round(rsi14),
      vol,
      trend,
      stSig,
      p5d: round(p5d),
      p1m: round(p1m),
      timestamp: new Date().toISOString(),
      source: "Yahoo Finance (live)",
    };
  } catch (err) {
    return {
      ticker: symbol,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Math helpers ───
function round(n) {
  return Math.round(n * 100) / 100;
}

function sma(arr, period) {
  if (arr.length < period) return arr[arr.length - 1] || 0;
  let sum = 0;
  for (let i = arr.length - period; i < arr.length; i++) sum += arr[i];
  return sum / period;
}

function ema(arr, period) {
  const k = 2 / (period + 1);
  const r = [arr[0]];
  for (let i = 1; i < arr.length; i++)
    r.push(arr[i] * k + r[i - 1] * (1 - k));
  return r;
}

function calcMACD(closes) {
  if (closes.length < 26)
    return { value: 0, signal: 0, histogram: 0 };
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const sig = ema(macdLine, 9);
  const n = macdLine.length - 1;
  return {
    value: macdLine[n],
    signal: sig[n],
    histogram: macdLine[n] - sig[n],
  };
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period,
    avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}
