const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const env = require("./config/env");
const { connectDatabase } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const publicRoutes = require("./routes/publicRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const tmcCustomApiRoutes = require("./custom-apis/the-man-company/routes");
const { rawBodySaver } = require("./middleware/webhook");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { setSocketServer } = require("./services/funnelService");
const { startFlitsQueue } = require("./services/flitsQueue");

function describeMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname || ""}`;
  } catch (err) {
    return "unparseable MongoDB URI";
  }
}

const app = express();
const server = http.createServer(app);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || env.apiOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true
};
const io = new Server(server, {
  cors: corsOptions
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing token"));
    const payload = jwt.verify(token, env.accessSecret);
    socket.auth = payload;
    return next();
  } catch (err) {
    return next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const stores = socket.auth.role === "super_admin" ? socket.handshake.auth?.storeIds || [] : socket.auth.tenantStoreIds || [];
  for (const storeId of stores) socket.join(`store:${storeId}`);
});

setSocketServer(io);

app.use(
  cors(corsOptions)
);
app.use(cookieParser());
app.use(express.json({ verify: rawBodySaver, limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "spin-the-wheel-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/custom-apis/the-man-company", tmcCustomApiRoutes);

app.use(notFound);
app.use(errorHandler);

async function start() {
  console.log("[startup] Spin The Wheel API booting");
  console.log(`[startup] Environment: ${env.nodeEnv}`);
  console.log(`[startup] Allowed dashboard origins: ${env.apiOrigins.join(", ")}`);
  console.log(`[startup] MongoDB target: ${describeMongoUri(env.mongoUri)}`);
  console.log("[startup] Connecting to MongoDB...");
  await connectDatabase();
  console.log("[startup] MongoDB connected");
  startFlitsQueue();
  server.listen(env.port, () => {
    console.log(`[startup] API listening on http://localhost:${env.port}`);
    console.log(`[startup] Health check: http://localhost:${env.port}/api/health`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, server, start };
