"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const openai_1 = __importDefault(require("openai"));
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "apodex/apodex-1.1-mini:free";
const FIRST_QUESTION = "How many r's are in the word 'strawberry'?";
const FOLLOW_UP_QUESTION = "Are you sure? Think carefully.";
function hasReasoningDetails(message) {
    return Object.prototype.hasOwnProperty.call(message, "reasoning_details");
}
function getAssistantMessage(response) {
    const message = response.choices[0]?.message;
    if (!message) {
        throw new Error("OpenRouter returned no assistant message.");
    }
    return message;
}
function getReply(message) {
    const reply = message.content?.trim();
    if (!reply) {
        throw new Error("OpenRouter returned reasoning but no visible assistant reply.");
    }
    return reply;
}
function getUsageText(response) {
    const usage = response.usage;
    if (!usage) {
        return "not reported";
    }
    return `prompt=${String(usage.prompt_tokens)}, completion=${String(usage.completion_tokens)}, total=${String(usage.total_tokens)}`;
}
async function runOpenRouterReasoningTest() {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is missing. Set it only in the shell or a local untracked env file.");
    }
    const model = DEFAULT_MODEL;
    const client = new openai_1.default({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
            "HTTP-Referer": "https://vybaa.app",
            "X-OpenRouter-Title": "Vybaa OpenRouter reasoning smoke test",
        },
    });
    const firstRequest = {
        max_tokens: 600,
        messages: [{ content: FIRST_QUESTION, role: "user" }],
        model,
        reasoning: { enabled: true },
        temperature: 0,
    };
    const firstResponse = await client.chat.completions.create(firstRequest);
    const firstMessage = getAssistantMessage(firstResponse);
    if (!hasReasoningDetails(firstMessage)) {
        throw new Error("OpenRouter returned no reasoning_details to preserve for the follow-up request.");
    }
    const continuedMessages = [
        { content: FIRST_QUESTION, role: "user" },
        {
            content: firstMessage.content ?? "",
            reasoning_details: firstMessage.reasoning_details,
            role: "assistant",
        },
        { content: FOLLOW_UP_QUESTION, role: "user" },
    ];
    const secondRequest = {
        max_tokens: 600,
        messages: continuedMessages,
        model,
        temperature: 0,
    };
    const secondResponse = await client.chat.completions.create(secondRequest);
    const secondMessage = getAssistantMessage(secondResponse);
    console.log("OpenRouter reasoning smoke test passed: two calls completed and reasoning_details was preserved.");
    console.log(`Model: ${model}`);
    console.log(`First reply: ${getReply(firstMessage)}`);
    console.log(`Follow-up reply: ${getReply(secondMessage)}`);
    console.log(`First usage: ${getUsageText(firstResponse)}`);
    console.log(`Follow-up usage: ${getUsageText(secondResponse)}`);
}
void runOpenRouterReasoningTest().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown OpenRouter error.";
    console.error(`OpenRouter reasoning smoke test failed: ${message}`);
    process.exitCode = 1;
});
