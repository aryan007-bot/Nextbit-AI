import dotenv from "dotenv";
dotenv.config();

// Load db.ts *after* dotenv to ensure MONGODB_URI is available
const { connectDB } = await import("./config/db.js");

async function testConnection() {
  try {
    console.log("🧪 Testing MongoDB Atlas connection...");
    await connectDB();
    console.log("✅ Connected successfully to MongoDB Atlas!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Connection failed:", error);
    process.exit(1);
  }
}

testConnection();
