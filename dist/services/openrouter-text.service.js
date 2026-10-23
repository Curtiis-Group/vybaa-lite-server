"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOpenRouterText = generateOpenRouterText;
exports.generateOpenRouterTextStream = generateOpenRouterTextStream;
const openai_1 = __importDefault(require("openai"));
const ai_provider_config_1 = require("../config/ai-provider.config");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_OUTPUT_TOKENS = 600;
function createOpenRouterClient(timeoutMs) {
    const apiKey = env_util_1.Env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not configured");
    }
    return new openai_1.default({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        ...(timeoutMs ? { timeout: timeoutMs, maxRetries: 0 } : {}),
        defaultHeaders: {
            "HTTP-Referer": "https://vybaa.app",
            "X-OpenRouter-Title": "Vybaa",
        },
    });
}
async function generateOpenRouterText(request) {
    const providerConfig = (0, ai_provider_config_1.getAiTextProviderConfig)(request.feature);
    if (providerConfig.provider !== ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER) {
        throw new Error(`OpenRouter was requested for ${request.feature}, but its configured provider is ${providerConfig.provider}`);
    }
    const messages = [];
    if (request.systemInstruction) {
        messages.push({ content: request.systemInstruction, role: "system" });
    }
    messages.push({ content: request.prompt, role: "user" });
    const openRouterRequest = {
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages,
        model: providerConfig.model,
        temperature: request.temperature ?? 0.2,
    };
    if (request.reasoningEnabled ?? providerConfig.reasoningEnabled) {
        openRouterRequest.reasoning = { enabled: true };
    }
    if (request.privacyMode) {
        openRouterRequest.provider = { data_collection: "deny", zdr: true };
    }
    if (request.jsonSchema) {
        openRouterRequest.response_format = {
            json_schema: {
                name: `${request.feature.toLowerCase()}_response`,
                schema: request.jsonSchema,
                strict: true,
            },
            type: "json_schema",
        };
    }
    const startedAt = Date.now();
    logAiRequestStarted(request, providerConfig.model, request.reasoningEnabled ?? providerConfig.reasoningEnabled, false);
    try {
        const response = await createOpenRouterClient(request.timeoutMs).chat.completions.create(openRouterRequest);
        const content = response.choices[0]?.message.content?.trim();
        if (!content) {
            throw new Error(`OpenRouter returned no visible text for ${request.feature}`);
        }
        await request.onUsage?.(response.usage);
        logger_util_1.default.info("AI request completed", {
            completionTokens: response.usage?.completion_tokens,
            durationMs: Date.now() - startedAt,
            feature: request.feature,
            model: providerConfig.model,
            outputChars: content.length,
            promptTokens: response.usage?.prompt_tokens,
            provider: ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER,
            stream: false,
            totalTokens: response.usage?.total_tokens,
        });
        return content;
    }
    catch (error) {
        logger_util_1.default.error("AI request failed", {
            ...describeError(error),
            durationMs: Date.now() - startedAt,
            feature: request.feature,
            model: providerConfig.model,
            provider: ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER,
            stream: false,
        });
        throw error;
    }
}
async function generateOpenRouterTextStream(request) {
    const providerConfig = (0, ai_provider_config_1.getAiTextProviderConfig)(request.feature);
    if (providerConfig.provider !== ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER) {
        throw new Error(`OpenRouter was requested for ${request.feature}, but its configured provider is ${providerConfig.provider}`);
    }
    const messages = [];
    if (request.systemInstruction) {
        messages.push({ content: request.systemInstruction, role: "system" });
    }
    messages.push({ content: request.prompt, role: "user" });
    const openRouterRequest = {
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages,
        model: providerConfig.model,
        stream: true,
        temperature: request.temperature ?? 0.2,
    };
    if (request.reasoningEnabled ?? providerConfig.reasoningEnabled) {
        openRouterRequest.reasoning = { enabled: true };
    }
    if (request.privacyMode) {
        openRouterRequest.provider = { data_collection: "deny", zdr: true };
    }
    if (request.jsonSchema) {
        openRouterRequest.response_format = {
            json_schema: {
                name: `${request.feature.toLowerCase()}_response`,
                schema: request.jsonSchema,
                strict: true,
            },
            type: "json_schema",
        };
    }
    const startedAt = Date.now();
    logAiRequestStarted(request, providerConfig.model, request.reasoningEnabled ?? providerConfig.reasoningEnabled, true);
    try {
        const response = await createOpenRouterClient(request.timeoutMs).chat.completions.create(openRouterRequest);
        let content = "";
        for await (const chunk of response) {
            const delta = chunk.choices[0]?.delta.content ?? "";
            if (!delta)
                continue;
            content += delta;
            await request.onDelta(delta);
        }
        const normalizedContent = content.trim();
        if (!normalizedContent) {
            throw new Error(`OpenRouter returned no visible text for ${request.feature}`);
        }
        logger_util_1.default.info("AI request completed", {
            durationMs: Date.now() - startedAt,
            feature: request.feature,
            model: providerConfig.model,
            outputChars: normalizedContent.length,
            provider: ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER,
            stream: true,
        });
        return normalizedContent;
    }
    catch (error) {
        logger_util_1.default.error("AI request failed", {
            ...describeError(error),
            durationMs: Date.now() - startedAt,
            feature: request.feature,
            model: providerConfig.model,
            provider: ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER,
            stream: true,
        });
        throw error;
    }
}
function logAiRequestStarted(request, model, reasoningEnabled, stream) {
    logger_util_1.default.info("AI request started", {
        feature: request.feature,
        maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        model,
        provider: ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled,
        stream,
        structuredOutput: Boolean(request.jsonSchema),
    });
}
function describeError(error) {
    if (error instanceof Error) {
        const status = getErrorProperty(error, "status");
        const code = getErrorProperty(error, "code");
        const body = getErrorProperty(error, "error");
        const metadata = isRecord(body) && isRecord(body.metadata) ? body.metadata : null;
        const details = {};
        if (metadata) {
            if (typeof metadata.provider_name === "string") {
                details.providerName = metadata.provider_name.slice(0, 80);
            }
            if (typeof metadata.provider_error_code === "string") {
                details.providerErrorCode = metadata.provider_error_code.slice(0, 100);
            }
            // Never log raw provider bodies: they can echo private prompts or keys.
            // Extract only schema diagnostics from an identifiable validation error.
            if (typeof metadata.raw === "string") {
                const validation = readSchemaValidationError(metadata.raw);
                Object.assign(details, validation);
            }
        }
        return {
            ...details,
            ...(typeof code === "string" ? { errorCode: code } : {}),
            errorMessage: error.message,
            errorName: error.name,
            ...(typeof status === "number" ? { providerStatus: status } : {}),
        };
    }
    return { errorMessage: String(error) };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readSchemaValidationError(raw) {
    if (raw.length > 16000)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        // Some providers return plain text rather than JSON. Do not log that body.
        return {};
    }
    if (!isRecord(parsed) || !isRecord(parsed.error))
        return {};
    const validation = parsed.error;
    if (validation.code !== "invalid_json_schema")
        return {};
    const missingField = typeof validation.message === "string"
        ? /Missing '([A-Za-z_][A-Za-z0-9_]{0,79})'/.exec(validation.message)?.[1]
        : undefined;
    return {
        providerErrorCode: "invalid_json_schema",
        ...(validation.param === "text.format.schema" ||
            validation.param === "response_format"
            ? { providerParameter: validation.param }
            : {}),
        ...(missingField ? { schemaMissingField: missingField } : {}),
    };
}
function getErrorProperty(error, property) {
    return Reflect.get(error, property);
}
