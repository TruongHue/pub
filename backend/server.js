require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const horoscopeRoutes = require("./routes/horoscopeRoutes");
const { runPipeline } = require("./controllers/horoscopeController");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:4200",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
