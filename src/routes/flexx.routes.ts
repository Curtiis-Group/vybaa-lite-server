import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  decodeFlexxFeedCursor,
  getFlexxDesignPage,
} from "../services/flexx-design.service";
import { flexxFeedQuerySchema } from "../validators/flexx-design.validators";
import logger from "../utils/logger.util";
import {
  FlexxAnswerError,
  flexxAnswerInputSchema,
  listFlexxAnswers,
  saveFlexxAnswer,
} from "../services/flexx-questionnaire.service";

const router: Router = Router();
router.get("/designs", authMiddleware, async (req: AuthRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ msg: "Authentication required" });
    return;
  }
  const parsed = flexxFeedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ msg: "Invalid Flexx feed query" });
    return;
  }
  let cursor: { page: number; snapshot?: string };
  try {
    cursor = decodeFlexxFeedCursor(
      parsed.data.cursor,
      parsed.data.category,
      req.userId,
    );
  } catch {
    res.status(400).json({ msg: "Invalid Flexx cursor" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      data: await getFlexxDesignPage({
        category: parsed.data.category,
        ...cursor,
        userId: req.userId,
      }),
    });
  } catch (error: unknown) {
    logger.error("Flexx design feed failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res
      .status(503)
      .json({ msg: "More designs are unavailable. Please retry." });
  }
});

router.get(
  "/questionnaire/answers",
  authMiddleware,
  async (req: AuthRequest, res) => {
    if (!req.userId) {
      res.status(401).json({ msg: "Authentication required" });
      return;
    }
    try {
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ data: await listFlexxAnswers(req.userId) });
    } catch (error: unknown) {
      if (error instanceof FlexxAnswerError) {
        res.status(error.statusCode).json({ msg: error.message });
        return;
      }
      logger.error("Unable to load Flexx answers", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      res
        .status(503)
        .json({ msg: "Couldn't load your answers. Please retry." });
    }
  },
);
router.post(
  "/questionnaire/answers",
  authMiddleware,
  async (req: AuthRequest, res) => {
    if (!req.userId) {
      res.status(401).json({ msg: "Authentication required" });
      return;
    }
    const input = flexxAnswerInputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ msg: "Invalid questionnaire answer" });
      return;
    }
    try {
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ data: await saveFlexxAnswer(req.userId, input.data) });
    } catch (error: unknown) {
      if (error instanceof FlexxAnswerError) {
        res.status(error.statusCode).json({ msg: error.message });
        return;
      }
      logger.error("Unable to save Flexx answer", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      res.status(503).json({ msg: "Couldn't save your answer. Please retry." });
    }
  },
);
export default router;
