import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { upload } from "../middleware/upload.js";
import { parseDialerSheet } from "../services/sheetParser.js";
import Customer from "../models/Customer.js";

const router = Router();

// POST /api/upload/sheet - Upload dialer sheet
router.post(
  "/sheet",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: "No file uploaded" });
        return;
      }

      const customers = parseDialerSheet(req.file.buffer);

      // Upsert customers by callId
      const results = await Promise.all(
        customers.map(async (c) => {
          const doc = await Customer.findOneAndUpdate(
            { callId: c.callId },
            {
              $set: {
                name: c.name,
                phone: c.phone,
                email: c.email,
                loanType: c.loanType || "recovery",
                amountBorrowed: c.amountBorrowed || 0,
                totalPaid: c.totalPaid || 0,
                outstandingBalance: c.outstandingBalance || 0,
                overdueAmount: c.overdueAmount || 0,
                dpd: c.dpd || 0,
                "cardInfo.cardNumber": c.cardNumber,
                "cardInfo.cardType": c.cardType,
                "cardInfo.expiryDate": c.expiryDate,
                personaNotes: c.personaNotes,
                assignedAgent: c.assignedAgent,
              },
              $setOnInsert: {
                status: "active",
                paymentHistory: c.paymentHistory || [],
              },
            },
            { upsert: true, new: true }
          );
          return doc;
        })
      );

      res.json({
        success: true,
        message: `Processed ${customers.length} customers`,
        imported: results.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
