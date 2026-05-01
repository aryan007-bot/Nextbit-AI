import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import CallLog from "../models/CallLog.js";
import Customer from "../models/Customer.js";

const router = Router();

// GET /api/calls - List call logs
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { callId, outcome, page = "1", limit = "50" } = req.query;
    const filter: Record<string, unknown> = {};

    if (callId) filter.callId = callId;
    if (outcome) filter.outcome = outcome;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [calls, total] = await Promise.all([
      CallLog.find(filter)
        .populate("customerId", "name callId phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      CallLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: calls,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/calls - Create a call log
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { callId, startTime, endTime, durationSeconds, outcome, sentiment, transcripts, commitmentAmount, commitmentDate, notes } = req.body;

    const customer = await Customer.findOne({ callId });
    if (!customer) {
      res.status(404).json({ success: false, error: "Customer not found for this callId" });
      return;
    }

    const { aiFeedback } = req.body;

    const callLog = await CallLog.create({
      callId,
      customerId: customer._id,
      startTime: startTime ? new Date(startTime) : new Date(),
      endTime: endTime ? new Date(endTime) : undefined,
      durationSeconds,
      outcome,
      sentiment,
      transcripts,
      commitmentAmount,
      commitmentDate: commitmentDate ? new Date(commitmentDate) : undefined,
      notes,
      aiFeedback,
    });

    // Update customer lastContacted
    await Customer.updateOne({ _id: customer._id }, { $set: { lastContacted: new Date() } });

    res.status(201).json({ success: true, data: callLog });
  } catch (error) {
    next(error);
  }
});

// GET /api/calls/stats - Dashboard stats
router.get("/stats", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalCalls, outcomes, totalDuration] = await Promise.all([
      CallLog.countDocuments(),
      CallLog.aggregate([
        { $group: { _id: "$outcome", count: { $sum: 1 } } },
      ]),
      CallLog.aggregate([
        { $group: { _id: null, total: { $sum: "$durationSeconds" } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        totalCalls,
        outcomes: outcomes.reduce((acc, o) => ({ ...acc, [o._id]: o.count }), {}),
        totalDurationSeconds: totalDuration[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/calls/export - Export call logs + AI feedback as Excel
router.get("/export", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const calls = await CallLog.find()
      .populate("customerId", "name callId phone")
      .sort({ createdAt: -1 })
      .lean();

    const rows = calls.map((call: any) => ({
      "Call ID": call.callId,
      "Customer Name": call.customerId?.name || "N/A",
      "Customer Phone": call.customerId?.phone || "N/A",
      "Start Time": call.startTime ? new Date(call.startTime).toLocaleString("en-IN") : "",
      "End Time": call.endTime ? new Date(call.endTime).toLocaleString("en-IN") : "",
      "Duration (sec)": call.durationSeconds || 0,
      "Duration (min)": call.durationSeconds ? `${Math.floor(call.durationSeconds / 60)}:${(call.durationSeconds % 60).toString().padStart(2, '0')}` : "",
      "Outcome": call.outcome,
      "Sentiment": call.sentiment,
      "Commitment Amount": call.commitmentAmount || 0,
      "Commitment Date": call.commitmentDate ? new Date(call.commitmentDate).toLocaleDateString("en-IN") : "",
      "Notes": call.notes || "",
      "Customer Review / Final Feedback": call.aiFeedback?.finalFeedback || "",
      "AI Tone Used": call.aiFeedback?.toneUsed || "",
      "AI Customer Intent": call.aiFeedback?.customerIntent || "",
      "AI Agent Performance": call.aiFeedback?.agentPerformance || "",
      "AI Key Moments": call.aiFeedback?.keyMoments?.join("; ") || "",
      "AI Suggestions": call.aiFeedback?.suggestions || "",
      "AI Recovery Probability": call.aiFeedback?.recoveryProbability != null ? `${call.aiFeedback.recoveryProbability}%` : "",
      "Will Pay?": call.aiFeedback?.willPay || "",
      "Committed Amount": call.aiFeedback?.committedAmount != null ? `₹${call.aiFeedback.committedAmount}` : "",
      "Payment Timeline": call.aiFeedback?.paymentTimeline || "",
      "Final Feedback": call.aiFeedback?.finalFeedback || "",
      "Next Action": call.aiFeedback?.nextAction || "",
      "Created At": call.createdAt ? new Date(call.createdAt).toLocaleString("en-IN") : "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Call Feedback");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", "attachment; filename=call-feedback.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch (error) {
    next(error);
  }
});

export default router;
