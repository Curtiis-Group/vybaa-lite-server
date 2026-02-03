import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/auth.util";

export interface AuthRequest extends Request {
  userId?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ msg: "No token provided" });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ msg: "Invalid or expired token" });
    }

    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ msg: "Authentication failed" });
  }
}
