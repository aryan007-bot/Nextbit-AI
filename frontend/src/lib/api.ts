import { Customer, PaginatedResponse, CallLogPayload } from "../types/shared";

// In production (Vercel), calls go to the Render backend URL
// In development, Vite proxy forwards /api → localhost:3001
const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || "";
const API_BASE = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || "API Error");
  }
  return json;
}

export const api = {
  // Customers
  getCustomers: async (params?: { search?: string; loanType?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set("search", params.search);
    if (params?.loanType) query.set("loanType", params.loanType);
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    const res = await fetch(`${API_BASE}/customers?${query}`);
    return handleResponse<PaginatedResponse<Customer>>(res);
  },

  getCustomerByCallId: async (callId: string) => {
    const res = await fetch(`${API_BASE}/customers/${encodeURIComponent(callId)}`);
    return handleResponse<{ success: boolean; data: Customer }>(res);
  },

  updateCustomer: async (callId: string, updates: Partial<Customer>) => {
    const res = await fetch(`${API_BASE}/customers/${encodeURIComponent(callId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return handleResponse<{ success: boolean; data: Customer }>(res);
  },

  deleteAllCustomers: async () => {
    const res = await fetch(`${API_BASE}/customers`, {
      method: "DELETE",
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Upload
  uploadSheet: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/upload/sheet`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<{ success: boolean; message: string; imported: number }>(res);
  },

  // Call Logs
  getCalls: async (params?: { callId?: string; outcome?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.callId) query.set("callId", params.callId);
    if (params?.outcome) query.set("outcome", params.outcome);
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    const res = await fetch(`${API_BASE}/calls?${query}`);
    return handleResponse<PaginatedResponse<unknown>>(res);
  },

  createCallLog: async (payload: CallLogPayload) => {
    const res = await fetch(`${API_BASE}/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse<{ success: boolean; data: unknown }>(res);
  },

  getCallStats: async () => {
    const res = await fetch(`${API_BASE}/calls/stats`);
    return handleResponse<{ success: boolean; data: unknown }>(res);
  },

  exportCallsToExcel: async () => {
    const res = await fetch(`${API_BASE}/calls/export`);
    if (!res.ok) {
      const json = await res.json().catch(() => ({ error: "Export failed" }));
      throw new Error(json.error || "Export failed");
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-feedback-${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  generateAIFeedback: async (transcripts: string[]) => {
    const res = await fetch(`${API_BASE}/calls/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcripts }),
    });
    return handleResponse<{
      success: boolean;
      data: {
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
    }>(res);
  },
};

export type { Customer };
