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
console.log("🔍 MONGODB_URI =", process.env.MONGODB_URI);

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    /\.vercel\.app$/,
    /\.onrender\.com$/,
  ],
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api/customers", customerRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/calls", callRoutes);

// 404 & Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
      console.log(`API endpoints:`);
      console.log(`  POST /api/upload/sheet    - Upload dialer sheet`);
      console.log(`  GET  /api/customers       - List customers`);
      console.log(`  GET  /api/customers/:id   - Get customer by callId`);
      console.log(`  GET  /api/calls           - List call logs`);
      console.log(`  POST /api/calls           - Log a call`);
      console.log(`  GET  /api/calls/stats     - Dashboard stats`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
