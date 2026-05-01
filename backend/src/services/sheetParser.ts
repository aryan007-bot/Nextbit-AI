import xlsx from "xlsx";
import type { ParsedCustomer } from "../types/shared.js";

function cleanValue(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  const str = String(val).trim();
  return str.length > 0 ? str : undefined;
}

function toNumber(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((h) =>
    String(h)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
  );
}

export function parseDialerSheet(buffer: Buffer): ParsedCustomer[] {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (rawData.length < 2) {
    throw new Error("Sheet is empty or missing headers");
  }

  const rawHeaders = rawData[0] as string[];
  const headers = normalizeHeaders(rawHeaders);
  const rows = rawData.slice(1);

  // Debug: log normalized headers so mismatches are easy to spot
  console.log("[sheetParser] Detected columns:", headers);

  const idx = (name: string): number => headers.indexOf(name);

  const customers: ParsedCustomer[] = [];

  for (const row of rows) {
    const callId = cleanValue(row[idx("call_id")] ?? row[idx("callid")] ?? row[idx("id")]);
    const name = cleanValue(row[idx("customer_name")] ?? row[idx("name")] ?? row[idx("borrower_name")]);

    if (!callId || !name) continue;

    // Helper to pick the first defined numeric column from multiple fallback names
    const pickNum = (...names: string[]) => {
      for (const n of names) {
        const i = idx(n);
        if (i !== -1) {
          const v = toNumber(row[i]);
          if (v !== undefined) return v;
        }
      }
      return undefined;
    };

    const amountBorrowed = pickNum(
      "amount_borrowed", "loan_amount", "principal", "amount",
      "sanctioned_amount", "disbursed_amount", "credit_limit", "limit"
    );
    const outstandingBalance = pickNum(
      "outstanding_balance", "balance", "outstanding", "current_balance",
      "net_outstanding", "net_balance", "due_amount", "amount_due",
      "remaining_balance", "remaining", "emi_outstanding"
    );
    const overdueAmount = pickNum(
      "overdue_amount", "overdue", "pending", "pending_amount",
      "overdue_balance", "past_due", "arrears", "total_overdue",
      "due", "default_amount"
    );
    const totalPaid = pickNum(
      "total_paid", "amount_paid", "paid_amount", "payments_made",
      "total_payment", "paid"
    );
    const dpd = pickNum(
      "dpd", "days_past_due", "overdue_days", "days_overdue",
      "days_due", "delinquency_days"
    );

    const customer: ParsedCustomer = {
      callId,
      name,
      phone: cleanValue(
        row[idx("phone")] ?? row[idx("mobile")] ?? row[idx("contact")] ??
        row[idx("mobile_no")] ?? row[idx("phone_number")] ?? row[idx("cell")]
      ),
      email: cleanValue(row[idx("email")] ?? row[idx("email_id")] ?? row[idx("email_address")]),
      loanType: cleanValue(row[idx("loan_type")] ?? row[idx("type")] ?? row[idx("product_type")] ?? row[idx("product")]) || "recovery",
      amountBorrowed,
      totalPaid,
      outstandingBalance: outstandingBalance ?? (amountBorrowed !== undefined && totalPaid !== undefined ? amountBorrowed - totalPaid : undefined),
      overdueAmount: overdueAmount ?? outstandingBalance,
      dpd,
      cardNumber: cleanValue(row[idx("card_number")] ?? row[idx("card_no")] ?? row[idx("account_number")] ?? row[idx("account_no")]),
      cardType: cleanValue(row[idx("card_type")] ?? row[idx("account_type")]),
      expiryDate: cleanValue(row[idx("expiry_date")] ?? row[idx("expiry")] ?? row[idx("due_date")]),
      personaNotes: cleanValue(
        row[idx("persona_notes")] ?? row[idx("notes")] ?? row[idx("remarks")] ??
        row[idx("comment")] ?? row[idx("comments")] ?? row[idx("description")]
      ),
      assignedAgent: cleanValue(row[idx("assigned_agent")] ?? row[idx("agent")] ?? row[idx("agent_name")] ?? row[idx("collector")]),
    };

    // Parse payment history if columns exist
    const paymentDates: string[] = [];
    const paymentAmounts: number[] = [];
    const paymentMethods: string[] = [];
    const paymentStatuses: string[] = [];

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h.startsWith("payment_date")) {
        const val = cleanValue(row[i]);
        if (val) paymentDates.push(val);
      } else if (h.startsWith("payment_amount")) {
        const val = toNumber(row[i]);
        if (val !== undefined) paymentAmounts.push(val);
      } else if (h.startsWith("payment_method")) {
        const val = cleanValue(row[i]);
        if (val) paymentMethods.push(val);
      } else if (h.startsWith("payment_status")) {
        const val = cleanValue(row[i]);
        if (val) paymentStatuses.push(val);
      }
    }

    if (paymentDates.length > 0) {
      customer.paymentHistory = paymentDates.map((date, i) => ({
        date,
        amount: paymentAmounts[i] || 0,
        method: paymentMethods[i] || "unknown",
        status: paymentStatuses[i] || "completed",
      }));
    }

    customers.push(customer);
  }

  return customers;
}
