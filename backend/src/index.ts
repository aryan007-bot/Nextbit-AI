import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "path";
import { connectDB } from "./config/db.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import customerRoutes from "./routes/customers.js";
import uploadRoutes from "./routes/upload.js";
import callRoutes from "./routes/calls.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3001;

// Allow all origins in production (Vercel frontend + local dev)
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check — always responds even if DB is down
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Show server IP (for Atlas whitelist debugging)
app.get("/ip", async (_req, res) => {
  try {
    const ip = await new Promise<string>((resolve, reject) => {
      const req = (await import("https")).request({ hostname: "api.ipify.org", path: "/?format=json" }, (r) => {
        let d = ""; r.on("data", (c) => d += c);
        r.on("end", () => resolve(JSON.parse(d).ip));
      });
      req.on("error", reject); req.end();
    });
    res.json({ ip });
  } catch {
    res.json({ ip: "unknown" });
  }
});

// API Routes
app.use("/api/customers", customerRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/calls", callRoutes);

// 404 & Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Start server — DB failure does NOT crash the server
async function startServer() {
  // Start listening FIRST so health check works immediately
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Then try to connect DB (non-blocking)
  await connectDB();
}

startServer().catch(err => {
  console.error("Startup error:", err);
  // Don't exit — keep server running
});
