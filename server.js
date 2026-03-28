/**
 * ============================================================
 *  PATTERNSCAN — TradingView Webhook Server
 *  Receives alerts from TradingView and broadcasts them
 *  to the dashboard in real time via WebSocket.
 * ============================================================
 *
 *  QUICK START:
 *    1. npm install
 *    2. node server.js
 *    3. Point TradingView alerts to: http://YOUR_IP:3000/webhook
 *
 *  DEPLOY FREE:
 *    Railway  → https://railway.app   (recommended, free tier)
 *    Render   → https://render.com    (free tier)
 *    Glitch   → https://glitch.com    (free, always-on)
 * ============================================================
 */

const express   = require("express");
const http      = require("http");
const WebSocket = require("ws");
const cors      = require("cors");

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ── Config ──────────────────────────────────────────────────
const PORT          = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";   // optional security token
const MAX_SIGNALS   = 500;                                  // keep last N signals in memory

// ── State ────────────────────────────────────────────────────
const signals = [];         // in-memory ring buffer
const clients = new Set();  // connected WebSocket clients

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── WebSocket — dashboard connection ─────────────────────────
wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected · ${clients.size} total`);

  // Send last 50 signals to newly connected dashboard
  ws.send(JSON.stringify({ type: "history", signals: signals.slice(-50) }));

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected · ${clients.size} remaining`);
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ── POST /webhook — receives TradingView alerts ───────────────
app.post("/webhook", (req, res) => {
  // Optional secret token check
  if (WEBHOOK_SECRET) {
    const token = req.headers["x-webhook-secret"] || req.body.secret;
    if (token !== WEBHOOK_SECRET) {
      console.warn("[WEBHOOK] Unauthorized request blocked");
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const body = req.body;

  // Validate required fields
  if (!body.pattern || !body.symbol) {
    return res.status(400).json({ error: "Missing required fields: pattern, symbol" });
  }

  // Build signal object
  const signal = {
    id:      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    pattern: body.pattern,
    symbol:  body.symbol.toUpperCase(),
    tf:      body.tf || body.interval || "?",
    price:   body.price  ? parseFloat(body.price).toFixed(2)  : null,
    volume:  body.vol    ? parseInt(body.vol)                 : null,
    time:    body.time   || new Date().toISOString(),
    raw:     body,
  };

  // Store and trim
  signals.push(signal);
  if (signals.length > MAX_SIGNALS) signals.shift();

  // Broadcast to all dashboard clients
  broadcast({ type: "signal", signal });

  console.log(`[SIGNAL] ${signal.symbol} · ${signal.tf} · ${signal.pattern} @ $${signal.price}`);

  res.status(200).json({ ok: true, id: signal.id });
});

// ── GET /signals — REST fallback (polling) ───────────────────
app.get("/signals", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ signals: signals.slice(-limit) });
});

// ── GET /health ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status:   "ok",
    signals:  signals.length,
    clients:  clients.size,
    uptime:   process.uptime(),
  });
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║         PATTERNSCAN WEBHOOK SERVER       ║
╠══════════════════════════════════════════╣
║  HTTP  →  http://localhost:${PORT}          ║
║  WS    →  ws://localhost:${PORT}            ║
╠══════════════════════════════════════════╣
║  POST  /webhook   ← TradingView alerts   ║
║  GET   /signals   ← REST polling         ║
║  GET   /health    ← Status check         ║
╚══════════════════════════════════════════╝
  `);
});

// ── Live price proxy ───────────────────────────────────────────
const https_mod = require("https");

app.get("/prices", (req, res) => {
  const symbols = (req.query.symbols || "AAPL,TSLA,NVDA,AMD,GOOGL,AMZN,SPY,QQQ").toUpperCase();
  const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,regularMarketPreviousClose,shortName`;
  
  const options = {
    hostname: "query1.finance.yahoo.com",
    path: `/v8/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,regularMarketPreviousClose,shortName`,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
    }
  };

  https_mod.get(options, (response) => {
    let data = "";
    response.on("data", chunk => data += chunk);
    response.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        const results = parsed?.quoteResponse?.result || [];
        const prices = {};
        results.forEach(q => {
          prices[q.symbol] = {
            price: q.regularMarketPrice || 0,
            change: q.regularMarketChangePercent || 0,
            volume: q.regularMarketVolume || 0,
            prev: q.regularMarketPreviousClose || q.regularMarketPrice || 0,
            name: q.shortName || q.symbol,
          };
        });
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json({ ok: true, prices, updated: new Date().toISOString() });
      } catch(e) {
        res.json({ ok: false, error: e.message });
      }
    });
  }).on("error", e => res.json({ ok: false, error: e.message }));
});
