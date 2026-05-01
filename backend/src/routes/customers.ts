import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import Customer from "../models/Customer.js";

const router = Router();

// GET /api/customers - List all customers (with optional filters)
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { loanType, status, search, page = "1", limit = "50" } = req.query;
    const filter: Record<string, unknown> = {};

    if (loanType) filter.loanType = loanType;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { callId: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [customers, total] = await Promise.all([
      Customer.find(filter).sort({ dpd: -1 }).skip(skip).limit(limitNum).lean(),
      Customer.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: customers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/customers/:callId - Get single customer by call ID
router.get("/:callId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await Customer.findOne({ callId: req.params.callId }).lean();
    if (!customer) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }
    res.json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/customers/:callId - Update customer
router.patch("/:callId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedUpdates = [
      "name", "phone", "email", "loanType", "amountBorrowed",
      "totalPaid", "outstandingBalance", "overdueAmount", "dpd",
      "personaNotes", "assignedAgent", "status", "lastContacted",
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const customer = await Customer.findOneAndUpdate(
      { callId: req.params.callId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!customer) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/customers - Clear ALL customers (bulk delete uploaded data)
router.delete("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    console.log("[DELETE /api/customers] Bulk delete requested");
    const result = await Customer.deleteMany({});
    console.log(`[DELETE /api/customers] Deleted ${result.deletedCount} customers`);
    res.json({ success: true, message: `Deleted ${result.deletedCount} customers` });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/customers/:callId - Delete single customer
router.delete("/:callId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log(`[DELETE /api/customers/:callId] Deleting customer: ${req.params.callId}`);
    const result = await Customer.deleteOne({ callId: req.params.callId });
    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }
    res.json({ success: true, message: "Customer deleted" });
  } catch (error) {
    next(error);
  }
});

export default router;
