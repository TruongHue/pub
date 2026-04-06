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
