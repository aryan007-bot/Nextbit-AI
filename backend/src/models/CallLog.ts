import mongoose, { Schema, Document } from "mongoose";

export interface ICallLog extends Document {
  callId: string;
  customerId: mongoose.Types.ObjectId;
  agentName: string;
  startTime: Date;
  endTime?: Date;
  durationSeconds?: number;
  outcome: "resolved" | "negotiated" | "callback_scheduled" | "not_connected" | "declined" | "customer_out_of_country" | "voicemail" | "disconnected";
  sentiment: "neutral" | "cooperative" | "resistant" | "agitated";
  transcripts: { speaker: string; text: string; timestamp: Date }[];
  commitmentAmount?: number;
  commitmentDate?: Date;
  notes?: string;
  aiFeedback?: {
    toneUsed: "polite" | "witty" | "calm" | "apologetic";
    customerIntent: string;
    agentPerformance: string;
    keyMoments: string[];
    suggestions: string;
    recoveryProbability: number;
    willPay: "yes" | "no" | "partial" | "unclear";
    committedAmount: number;
    paymentTimeline: string;
    finalFeedback: string;
    nextAction: string;
  };
  createdAt: Date;
}

const CallLogSchema: Schema = new Schema(
  {
    callId: { type: String, required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    agentName: { type: String, default: "Isha" },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    durationSeconds: { type: Number },
    outcome: {
      type: String,
      enum: ["resolved", "negotiated", "callback_scheduled", "not_connected", "declined", "customer_out_of_country", "voicemail", "disconnected"],
      default: "not_connected",
    },
    sentiment: {
      type: String,
      enum: ["neutral", "cooperative", "resistant", "agitated"],
      default: "neutral",
    },
    transcripts: [
      {
        speaker: { type: String, required: true },
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    commitmentAmount: { type: Number },
    commitmentDate: { type: Date },
    notes: { type: String },
    aiFeedback: {
      toneUsed: { type: String, enum: ["polite", "witty", "calm", "apologetic"] },
      customerIntent: { type: String },
      agentPerformance: { type: String },
      keyMoments: [{ type: String }],
      suggestions: { type: String },
      recoveryProbability: { type: Number, min: 0, max: 100 },
      willPay: { type: String, enum: ["yes", "no", "partial", "unclear"] },
      committedAmount: { type: Number },
      paymentTimeline: { type: String },
      finalFeedback: { type: String },
      nextAction: { type: String },
    },
  },
  { timestamps: true }
);

export default mongoose.model<ICallLog>("CallLog", CallLogSchema);
