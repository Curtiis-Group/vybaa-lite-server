import OpenAI from "openai";
import {
  AI_TEXT_PROVIDER,
  getAiTextProviderConfig,
  type AiTextFeature,
} from "../config/ai-provider.config";
import { Env } from "../utils/env.util";

type OpenRouterTextRequest = {
  feature: AiTextFeature;
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  prompt: string;
  reasoningEnabled?: boolean;
  systemInstruction?: string;
  temperature?: number;
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

  const response = await createOpenRouterClient().chat.completions.create(
    openRouterRequest,
  );
  const content = response.choices[0]?.message.content?.trim();

  if (!content) {
    throw new Error(
      `OpenRouter returned no visible text for ${request.feature}`,
    );
  }

  return content;
}
