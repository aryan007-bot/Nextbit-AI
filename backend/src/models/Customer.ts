import mongoose, { Schema, Document } from "mongoose";

export interface ICustomer extends Document {
  callId: string;
  name: string;
  phone?: string;
  email?: string;
  loanType: "recovery" | "sales";
  amountBorrowed: number;
  totalPaid: number;
  outstandingBalance: number;
  overdueAmount: number;
  dpd: number;
  cardInfo?: {
    cardNumber?: string;
    cardType?: string;
    expiryDate?: string;
  };
  paymentHistory: {
    date: Date;
    amount: number;
    method: string;
    status: string;
  }[];
  personaNotes?: string;
  assignedAgent?: string;
  status: "active" | "settled" | "legal" | "closed";
  lastContacted?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema: Schema = new Schema(
  {
    callId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    loanType: { type: String, enum: ["recovery", "sales"], default: "recovery" },
    amountBorrowed: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    overdueAmount: { type: Number, default: 0 },
    dpd: { type: Number, default: 0 },
    cardInfo: {
      cardNumber: { type: String },
      cardType: { type: String },
      expiryDate: { type: String },
    },
    paymentHistory: [
      {
        date: { type: Date, required: true },
        amount: { type: Number, required: true },
        method: { type: String, default: "unknown" },
        status: { type: String, default: "completed" },
      },
    ],
    personaNotes: { type: String },
    assignedAgent: { type: String },
    status: { type: String, enum: ["active", "settled", "legal", "closed"], default: "active" },
    lastContacted: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<ICustomer>("Customer", CustomerSchema);
