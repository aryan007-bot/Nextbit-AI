import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nextbit_recovery";

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB connected:", MONGODB_URI);
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}
