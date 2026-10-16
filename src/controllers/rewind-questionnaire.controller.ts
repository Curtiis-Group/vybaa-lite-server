import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  answerRewindQuestionnaire,
  finishRewindQuestionnaire,
  questionnaireAnswerInputSchema,
  questionnaireSessionParamsSchema,
  RewindQuestionnaireError,
  startRewindQuestionnaire,
} from "../services/rewind-questionnaire.service";
import { RewindRoutineAvailabilityError } from "../services/rewind-routine.service";
import { handleSubscriptionAccessError } from "../services/subscription-access.service";
import logger from "../utils/logger.util";

function handleError(error: unknown, res: Response): void {
  if (handleSubscriptionAccessError(error, res)) return;
  if (error instanceof RewindQuestionnaireError) {
    res.status(error.statusCode).json({ msg: error.message });
    return;
  }
  if (error instanceof RewindRoutineAvailabilityError) {
    res
      .status(409)
      .json({
        msg: "Your Rewind is outside its scheduled window. Check your routine for the next session.",
      });
    return;
  }
  logger.error("Rewind questionnaire request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  res
    .status(500)
    .json({
      msg: "Your Rewind could not be saved. Your answers are kept; please try again.",
    });
}

export async function startQuestionnaire(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ msg: "Authentication required" });
    return;
  }
  try {
    res.json({
      data: await startRewindQuestionnaire(req.userId, req.clientApp),
    });
  } catch (error: unknown) {
    handleError(error, res);
  }
}

export async function answerQuestionnaire(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ msg: "Authentication required" });
    return;
  }
  const params = questionnaireSessionParamsSchema.parse(req.params);
  const input = questionnaireAnswerInputSchema.parse(req.body);
  try {
    res.json({
      data: await answerRewindQuestionnaire(
        req.userId,
        params.sessionId,
        input,
      ),
    });
  } catch (error: unknown) {
    handleError(error, res);
  }
}

export async function finishQuestionnaire(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ msg: "Authentication required" });
    return;
  }
  const params = questionnaireSessionParamsSchema.parse(req.params);
  try {
    res.json({
      data: await finishRewindQuestionnaire(req.userId, params.sessionId),
    });
  } catch (error: unknown) {
    handleError(error, res);
  }
}
