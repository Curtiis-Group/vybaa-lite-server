"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordGeminiUsage = recordGeminiUsage;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const DEFAULT_INPUT_RATE = 0.75;
const DEFAULT_OUTPUT_RATE = 3.75;
function positiveInteger(value) {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0;
}
function getRate(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
async function recordGeminiUsage(params) {
    const inputTokens = positiveInteger(params.metadata?.promptTokenCount);
    const outputTokens = positiveInteger((params.metadata?.candidatesTokenCount ?? 0) +
        (params.metadata?.thoughtsTokenCount ?? 0));
    const totalTokens = positiveInteger(params.metadata?.totalTokenCount) ||
        inputTokens + outputTokens;
    const inputRateUsdPerMillion = getRate("GEMINI_INPUT_USD_PER_MILLION", DEFAULT_INPUT_RATE);
    const outputRateUsdPerMillion = getRate("GEMINI_OUTPUT_USD_PER_MILLION", DEFAULT_OUTPUT_RATE);
    const estimatedCostUsd = (inputTokens * inputRateUsdPerMillion +
        outputTokens * outputRateUsdPerMillion) /
        1000000;
    try {
        await db_config_1.prisma.aiUsageLedger.upsert({
            create: {
                estimatedCostUsd,
                idempotencyKey: params.idempotencyKey,
                inputRateUsdPerMillion,
                inputTokens,
                metadata: params.metadata ?? undefined,
                model: params.model,
                operation: params.operation,
                ...(params.runId ? { runId: params.runId } : {}),
                ...(params.turnId ? { turnId: params.turnId } : {}),
                outputRateUsdPerMillion,
                outputTokens,
                provider: "GOOGLE_GEMINI",
                totalTokens,
                userId: params.userId,
            },
            update: {},
            where: { idempotencyKey: params.idempotencyKey },
        });
    }
    catch (error) {
        logger_util_1.default.error("Unable to persist AI usage ledger entry", {
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorStack: error instanceof Error ? error.stack : undefined,
            idempotencyKey: params.idempotencyKey,
            model: params.model,
            operation: params.operation,
            runId: params.runId,
            turnId: params.turnId,
            userId: params.userId,
        });
    }
}
