import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

export async function listFeatureFlags(_req: AuthRequest, res: Response) {
  try {
    const flags = await prisma.featureFlag.findMany({
      orderBy: { key: "asc" },
    });

    res.json({
      msg: "Feature flags retrieved successfully",
      data: flags,
    });
  } catch (error) {
    logger.error("List feature flags error:", { error });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function upsertFeatureFlag(req: AuthRequest, res: Response) {
  try {
    const { key, enabled } = req.body as { key?: string; enabled?: boolean };

    if (!key) {
      return res.status(400).json({ msg: "Feature flag key is required" });
    }

    const flag = await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled: !!enabled },
      update: { enabled: !!enabled },
    });

    res.json({
      msg: "Feature flag updated successfully",
      data: flag,
    });
  } catch (error) {
    logger.error("Upsert feature flag error:", { error });
    res.status(500).json({ msg: "Internal server error" });
  }
}

