import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nextbit_recovery";

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    console.log("MongoDB connected:", MONGODB_URI.replace(/:([^@]+)@/, ":***@"));
  } catch (error) {
    // Don't crash — log and continue. APIs will return empty data.
    console.error("MongoDB connection failed (continuing without DB):", (error as Error).message);
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}
