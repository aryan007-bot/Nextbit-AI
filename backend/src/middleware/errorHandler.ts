import type { Request, Response, NextFunction } from "express";

export interface ApiError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  console.error("[Error]", status, message);
  if (err.stack) console.error(err.stack);

  res.status(status).json({
    success: false,
    error: message,
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
}
