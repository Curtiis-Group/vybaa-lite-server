"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTranscriptionRouter = createTranscriptionRouter;
const express_1 = __importStar(require("express"));
const zod_1 = require("zod");
const transcription_config_1 = require("../config/transcription.config");
const auth_middleware_1 = require("../middleware/auth.middleware");
const transcription_service_1 = require("../services/transcription.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const requestIdSchema = zod_1.z.string().uuid();
function createTranscriptionRouter(service = new transcription_service_1.TranscriptionService(), authenticate = auth_middleware_1.authMiddleware) {
    const router = (0, express_1.Router)();
    router.post("/", authenticate, express_1.default.raw({
        type: ["audio/*", "application/ogg"],
        limit: transcription_config_1.transcriptionConfig.maxBytes,
    }), async (req, res) => {
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
        const onClose = () => {
            if (!res.writableFinished)
                controller.abort();
        };
        res.once("close", onClose);
        const started = Date.now();
        try {
            const audio = (0, transcription_service_1.validateTranscriptionAudio)(req.body, req.header("content-type") ?? "");
            logger_util_1.default.info("Transcribing audio recording", {
                bytes: audio.bytes.length,
                mimeType: audio.mimeType,
                requestId: id.data,
            });
            const data = await service.create(req.userId, id.data, audio, controller.signal);
            if (!controller.signal.aborted)
                res.json({ msg: "Recording transcribed", data });
            logger_util_1.default.info("Audio transcription ready", {
                durationMs: Date.now() - started,
                requestId: id.data,
            });
        }
        catch (error) {
            const known = error instanceof transcription_service_1.TranscriptionError;
            const status = known ? error.status : 500;
            logger_util_1.default.warn("Audio transcription failed", {
                status,
                code: known ? error.code : "TRANSCRIPTION_FAILED",
                durationMs: Date.now() - started,
                requestId: id.data,
            });
            if (!controller.signal.aborted) {
                if (status === 429)
                    res.setHeader("Retry-After", "600");
                res
                    .status(status)
                    .json({
                    code: known ? error.code : "TRANSCRIPTION_FAILED",
                    msg: known
                        ? error.message
                        : "Transcription failed. Please retry your recording.",
                });
            }
        }
        finally {
            res.off("close", onClose);
        }
    });
    return router;
}
exports.default = createTranscriptionRouter();
