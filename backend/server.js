require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const horoscopeRoutes = require("./routes/horoscopeRoutes");
const { runPipeline } = require("./controllers/horoscopeController");

const app = express();
const server = http.createServer(app);
function socketIoCorsOrigin() {
  const raw = process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN;
  if (!raw || raw.trim() === "*") {
    return true;
  }
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return true;
  }
  return list.length === 1 ? list[0] : list;
}

const io = new Server(server, {
  cors: {
    origin: socketIoCorsOrigin(),
    methods: ["GET", "POST"]
  }
});

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-astrology-backend" });
});

app.use("/api", horoscopeRoutes);

io.on("connection", (socket) => {
  socket.on("ask-horoscope", async (payload) => {
    try {
      const { name, birthDate, question } = payload || {};
      if (!name || !birthDate || !question) {
        socket.emit("ai-error", {
          message: "Missing required fields: name, birthDate, question"
        });
        return;
      }

      socket.emit("ai-status", { stage: "processing" });
      const result = await runPipeline(payload);
      socket.emit("ai-response", result);
    } catch (error) {
      socket.emit("ai-error", { message: error.message || "Unknown server error" });
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Backend http://localhost:${PORT} (LAN: http://<IP-máy>:${PORT})`);
});

/**
 * Live comments service (port 3001).
 * Frontend `app.ts` uses this for "list comment" + queue building:
 * - socket: `live:join` -> listens `live:state`
 * - REST: POST `/api/live/start`, GET `/api/live/sessions`
 */
const liveApp = express();
const liveServer = http.createServer(liveApp);
const liveIo = new Server(liveServer, {
  cors: {
    origin: socketIoCorsOrigin(),
    methods: ["GET", "POST"]
  }
});

liveApp.use(
  cors({
    origin: true,
    credentials: true
  })
);
liveApp.use(express.json({ limit: "1mb" }));

/** In-memory live sessions for local dev. */
const liveSessions = new Map(); // sessionId -> { sessionId, createdAt, mainQueue: [] }
function ensureSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const existing = liveSessions.get(id);
  if (existing) return existing;
  const created = { sessionId: id, createdAt: Date.now(), mainQueue: [] };
  liveSessions.set(id, created);
  return created;
}

liveApp.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-astrology-live-comments" });
});

liveApp.post("/api/live/start", (req, res) => {
  const sessionId = req?.body?.sessionId;
  const sess = ensureSession(sessionId);
  if (!sess) {
    res.status(400).json({ error: "Missing sessionId" });
    return;
  }
  res.json({ ok: true, sessionId: sess.sessionId });
});

liveApp.get("/api/live/sessions", (_req, res) => {
  const sessions = Array.from(liveSessions.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => ({ sessionId: s.sessionId, createdAt: s.createdAt }));
  res.json({ sessions });
});

// Optional dev helper: push a comment into a session so UI can render it.
liveApp.post("/api/live/push", (req, res) => {
  const sessionId = req?.body?.sessionId;
  const username = req?.body?.username || "Viewer";
  const comment = req?.body?.comment || "";
  const sess = ensureSession(sessionId);
  if (!sess) {
    res.status(400).json({ error: "Missing sessionId" });
    return;
  }
  if (!String(comment).trim()) {
    res.status(400).json({ error: "Missing comment" });
    return;
  }
  const item = {
    id: crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    username: String(username || "Viewer"),
    comment: String(comment),
    timestamp: Date.now()
  };
  sess.mainQueue.push(item);
  if (sess.mainQueue.length > 250) sess.mainQueue.splice(0, sess.mainQueue.length - 250);
  liveIo.to(`live:${sess.sessionId}`).emit("live:state", { mainQueue: sess.mainQueue });
  res.json({ ok: true });
});

liveIo.on("connection", (socket) => {
  socket.on("live:join", (payload) => {
    const sessionId = payload?.sessionId;
    const sess = ensureSession(sessionId);
    if (!sess) return;
    const room = `live:${sess.sessionId}`;
    socket.join(room);
    socket.emit("live:state", { mainQueue: sess.mainQueue });
  });
});

// Né xung đột với project khác đang chiếm 3001
const LIVE_PORT = Number(process.env.LIVE_PORT) || 3001;
liveServer.listen(LIVE_PORT, HOST, () => {
  console.log(`Live comments http://localhost:${LIVE_PORT}`);
});
