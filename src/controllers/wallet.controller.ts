import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

/**
 * Get wallet balances:
 * - mainWalletBalance: "real points" (fundable later via Paystack/Polar)
 * - playWalletBalance: existing Play Points (kept as-is)
 *
 * Feature-flagged via FeatureFlag table (global).
 */
export async function getWallet(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const flag = await prisma.featureFlag.findUnique({
      where: { key: "REAL_WALLET" },
      select: { enabled: true },
    });
    const realWalletEnabled = flag?.enabled ?? false;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        points: true,
        realPointsBalance: true,
      },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      msg: "Wallet retrieved successfully",
      data: {
        realWalletEnabled,
        mainWalletBalance: user.realPointsBalance,
        playWalletBalance: user.points ?? 0,
      },
    });
  } catch (error) {
    logger.error("Get wallet error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

