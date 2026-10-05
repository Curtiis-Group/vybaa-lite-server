import OpenAI from "openai";
import {
  AI_TEXT_PROVIDER,
  getAiTextProviderConfig,
  type AiTextFeature,
} from "../config/ai-provider.config";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";

type OpenRouterTextRequest = {
  feature: AiTextFeature;
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  onUsage?: (usage: OpenRouterUsage | undefined) => Promise<void>;
  prompt: string;
  reasoningEnabled?: boolean;
  systemInstruction?: string;
  temperature?: number;
};

export type OpenRouterUsage = {
  completion_tokens?: number | null;
  prompt_tokens?: number | null;
  total_tokens?: number | null;
};

type OpenRouterRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  "messages"
> & {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  reasoning?: {
    enabled: boolean;
  };
};

type OpenRouterStreamingRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  "messages"
> & {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  reasoning?: {
    enabled: boolean;
  };
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_OUTPUT_TOKENS = 600;

function createOpenRouterClient(): OpenAI {
  const apiKey = Env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://vybaa.app",
      "X-OpenRouter-Title": "Vybaa",
    },
  });
}

export async function generateOpenRouterText(
  request: OpenRouterTextRequest,
): Promise<string> {
  const providerConfig = getAiTextProviderConfig(request.feature);

  if (providerConfig.provider !== AI_TEXT_PROVIDER.OPENROUTER) {
    throw new Error(
      `OpenRouter was requested for ${request.feature}, but its configured provider is ${providerConfig.provider}`,
    );
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (request.systemInstruction) {
    messages.push({ content: request.systemInstruction, role: "system" });
  }
  messages.push({ content: request.prompt, role: "user" });

  const openRouterRequest: OpenRouterRequest = {
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages,
    model: providerConfig.model,
    temperature: request.temperature ?? 0.2,
  };

  if (request.reasoningEnabled ?? providerConfig.reasoningEnabled) {
    openRouterRequest.reasoning = { enabled: true };
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
  logAiRequestStarted(
    request,
    providerConfig.model,
    request.reasoningEnabled ?? providerConfig.reasoningEnabled,
    false,
  );

  try {
    const response = await createOpenRouterClient().chat.completions.create(
      openRouterRequest,
    );
    const content = response.choices[0]?.message.content?.trim();

    if (!content) {
      throw new Error(
        `OpenRouter returned no visible text for ${request.feature}`,
      );
    }

    await request.onUsage?.(response.usage);
    logger.info("AI request completed", {
      completionTokens: response.usage?.completion_tokens,
      durationMs: Date.now() - startedAt,
      feature: request.feature,
      model: providerConfig.model,
      outputChars: content.length,
      promptTokens: response.usage?.prompt_tokens,
      provider: AI_TEXT_PROVIDER.OPENROUTER,
      stream: false,
      totalTokens: response.usage?.total_tokens,
    });
    return content;
  } catch (error: unknown) {
    logger.error("AI request failed", {
      ...describeError(error),
      durationMs: Date.now() - startedAt,
      feature: request.feature,
      model: providerConfig.model,
      provider: AI_TEXT_PROVIDER.OPENROUTER,
      stream: false,
    });
    throw error;
  }
}

export async function generateOpenRouterTextStream(
  request: OpenRouterTextRequest & {
    onDelta: (delta: string) => Promise<void>;
  },
): Promise<string> {
  const providerConfig = getAiTextProviderConfig(request.feature);

  if (providerConfig.provider !== AI_TEXT_PROVIDER.OPENROUTER) {
    throw new Error(
      `OpenRouter was requested for ${request.feature}, but its configured provider is ${providerConfig.provider}`,
    );
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (request.systemInstruction) {
    messages.push({ content: request.systemInstruction, role: "system" });
  }
  messages.push({ content: request.prompt, role: "user" });

  const openRouterRequest: OpenRouterStreamingRequest = {
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages,
    model: providerConfig.model,
    stream: true,
    temperature: request.temperature ?? 0.2,
  };

  if (request.reasoningEnabled ?? providerConfig.reasoningEnabled) {
    openRouterRequest.reasoning = { enabled: true };
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
  logAiRequestStarted(
    request,
    providerConfig.model,
    request.reasoningEnabled ?? providerConfig.reasoningEnabled,
    true,
  );

  try {
    const response = await createOpenRouterClient().chat.completions.create(
      openRouterRequest,
    );
    let content = "";
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta.content ?? "";
      if (!delta) continue;
      content += delta;
      await request.onDelta(delta);
    }

    const normalizedContent = content.trim();
    if (!normalizedContent) {
      throw new Error(
        `OpenRouter returned no visible text for ${request.feature}`,
      );
    }

    logger.info("AI request completed", {
      durationMs: Date.now() - startedAt,
      feature: request.feature,
      model: providerConfig.model,
      outputChars: normalizedContent.length,
      provider: AI_TEXT_PROVIDER.OPENROUTER,
      stream: true,
    });
    return normalizedContent;
  } catch (error: unknown) {
    logger.error("AI request failed", {
      ...describeError(error),
      durationMs: Date.now() - startedAt,
      feature: request.feature,
      model: providerConfig.model,
      provider: AI_TEXT_PROVIDER.OPENROUTER,
      stream: true,
    });
    throw error;
  }
}

function logAiRequestStarted(
  request: OpenRouterTextRequest,
  model: string,
  reasoningEnabled: boolean,
  stream: boolean,
): void {
  logger.info("AI request started", {
    feature: request.feature,
    maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    model,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled,
    stream,
    structuredOutput: Boolean(request.jsonSchema),
  });
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const status = getErrorProperty(error, "status");
    const code = getErrorProperty(error, "code");
    return {
      ...(typeof code === "string" ? { errorCode: code } : {}),
      errorMessage: error.message,
      errorName: error.name,
      ...(typeof status === "number" ? { providerStatus: status } : {}),
    };
  }
  return { errorMessage: String(error) };
}

function getErrorProperty(error: Error, property: string): unknown {
  return Reflect.get(error, property);
}
