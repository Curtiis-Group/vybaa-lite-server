import express, { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { transcriptionConfig } from "../config/transcription.config";
import { authMiddleware } from "../middleware/auth.middleware";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  TranscriptionError,
  TranscriptionService,
  validateTranscriptionAudio,
} from "../services/transcription.service";
import logger from "../utils/logger.util";

const requestIdSchema = z.string().uuid();

export function createTranscriptionRouter(
  service = new TranscriptionService(),
  authenticate: RequestHandler = authMiddleware,
): Router {
  const router = Router();
  router.post(
    "/",
    authenticate,
    express.raw({
      type: ["audio/*", "application/ogg"],
      limit: transcriptionConfig.maxBytes,
    }),
    async (req: AuthRequest, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
      }
      const id = requestIdSchema.safeParse(req.header("x-transcription-id"));
      if (!id.success) {
        res
          .status(400)
          .json({ msg: "A valid transcription request ID is required." });
        return;
      }
      const controller = new AbortController();
      const onClose = (): void => {
        if (!res.writableFinished) controller.abort();
      };
      res.once("close", onClose);
      const started = Date.now();
      try {
        const audio = validateTranscriptionAudio(
          req.body,
          req.header("content-type") ?? "",
        );
        logger.info("Transcribing audio recording", {
          bytes: audio.bytes.length,
          mimeType: audio.mimeType,
          requestId: id.data,
        });
        const data = await service.create(
          req.userId,
          id.data,
          audio,
          controller.signal,
        );
        if (!controller.signal.aborted)
          res.json({ msg: "Recording transcribed", data });
        logger.info("Audio transcription ready", {
          durationMs: Date.now() - started,
          requestId: id.data,
        });
      } catch (error: unknown) {
        const known = error instanceof TranscriptionError;
        const status = known ? error.status : 500;
        logger.warn("Audio transcription failed", {
          status,
          code: known ? error.code : "TRANSCRIPTION_FAILED",
          durationMs: Date.now() - started,
          requestId: id.data,
        });
        if (!controller.signal.aborted) {
          if (status === 429) res.setHeader("Retry-After", "600");
          res
            .status(status)
            .json({
              code: known ? error.code : "TRANSCRIPTION_FAILED",
              msg: known
                ? error.message
                : "Transcription failed. Please retry your recording.",
            });
        }
      } finally {
        res.off("close", onClose);
      }
    },
  );
  return router;
}

export default createTranscriptionRouter();
