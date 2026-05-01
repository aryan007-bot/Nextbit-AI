export interface Customer {
  _id: string;
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
    date: string;
    amount: number;
    method: string;
    status: string;
  }[];
  personaNotes?: string;
  assignedAgent?: string;
  status: string;
  lastContacted?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ParsedCustomer {
  callId: string;
  name: string;
  phone?: string;
  email?: string;
  loanType?: string;
  amountBorrowed?: number;
  totalPaid?: number;
  outstandingBalance?: number;
  overdueAmount?: number;
  dpd?: number;
  cardNumber?: string;
  cardType?: string;
  expiryDate?: string;
  personaNotes?: string;
  assignedAgent?: string;
  paymentHistory?: {
    date: string;
    amount: number;
    method: string;
    status: string;
  }[];
}

export interface CallLogPayload {
  callId: string;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  outcome?: string;
  sentiment?: string;
  transcripts?: { speaker: string; text: string; timestamp?: string }[];
  commitmentAmount?: number;
  commitmentDate?: string;
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
}
