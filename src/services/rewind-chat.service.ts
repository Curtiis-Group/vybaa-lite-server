import { GoogleGenAI, Type } from "@google/genai";
import type { RewindChat, RewindChatMessage } from "@prisma/client";
import {
  ActivitySignalSourceType,
  RewindChatMessageRole,
  RewindChatType,
} from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";
import { recordActivitySignal } from "./activity-signal.service";
import { getRecentObservationContext } from "./daily-observation.service";
import {
  formatRewindPersonalContext,
  loadRewindPersonalContext,
} from "./rewind-personal-context.service";

export type RewindPersonaId = "ariel" | "ella" | "jake" | "lyra";

const REWIND_PERSONAS: RewindPersonaId[] = ["ella", "lyra", "jake", "ariel"];
const PERSONA_NAMES: Record<RewindPersonaId, string> = {
  ariel: "Ariel",
  ella: "Ella",
  jake: "Jake",
  lyra: "Lyra",
};
const PERSONA_PROMPTS: Record<RewindPersonaId, string> = {
  ariel:
    "Ariel is empathetic, optimistic, and grounded. Ariel notices resilience, balance, adaptation, and possibility.",
  ella: "Ella is warm, gentle, and reflective. Ella notices emotional nuance, shifts in energy, and needs beneath the surface.",
  jake: "Jake is direct, energetic, and candid without being pushy. Jake notices agency, obstacles, wins, and practical next moves.",
  lyra: "Lyra is calm, poetic but concrete, and insight-oriented. Lyra notices patterns, contradictions, meaning, and quiet change.",
};

interface GeneratedChatReply {
  personaId: RewindPersonaId;
  reply: string;
}

export interface SerializedRewindChat {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  lastMessage: SerializedRewindChatMessage | null;
  lastMessageAt: string | null;
  personaId: RewindPersonaId | null;
  threadKey: string;
  title: string;
  type: RewindChatType;
  updatedAt: string;
}

export interface SerializedRewindChatMessage {
  content: string;
  createdAt: string;
  id: string;
  localDateKey: string;
  mentions: RewindPersonaId[];
  personaId: RewindPersonaId | null;
  role: RewindChatMessageRole;
}

function isPersonaId(value: unknown): value is RewindPersonaId {
  return (
    value === "ariel" ||
    value === "ella" ||
    value === "jake" ||
    value === "lyra"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 4_000);
}

export function extractRewindMentions(content: string): RewindPersonaId[] {
  const lowerContent = content.toLowerCase();
  return REWIND_PERSONAS.filter((personaId) =>
    new RegExp(`(^|\\s)@${personaId}\\b`).test(lowerContent),
  );
}

export function getRewindChatMessageIdempotencyKey(
  userId: string,
  chatId: string,
  clientKey: string,
): string {
  return `${userId}:${chatId}:${clientKey}`;
}

function serializeMessage(
  message: RewindChatMessage,
): SerializedRewindChatMessage {
  return {
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    localDateKey: message.localDateKey,
    mentions: message.mentions.filter(isPersonaId),
    personaId: isPersonaId(message.personaId) ? message.personaId : null,
    role: message.role,
  };
}

function serializeChat(
  chat: RewindChat,
  lastMessage: RewindChatMessage | null,
): SerializedRewindChat {
  return {
    archivedAt: chat.archivedAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
    id: chat.id,
    lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
    lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
    personaId: isPersonaId(chat.personaId) ? chat.personaId : null,
    threadKey: chat.threadKey,
    title: chat.title,
    type: chat.type,
    updatedAt: chat.updatedAt.toISOString(),
  };
}

function parseGeneratedReply(value: unknown): GeneratedChatReply {
  if (!isRecord(value)) {
    throw new Error("Rewind chat response was not an object");
  }
  const personaId = value.personaId;
  const reply =
    typeof value.reply === "string" ? normalizeContent(value.reply) : "";
  if (!isPersonaId(personaId) || !reply) {
    throw new Error("Rewind chat response omitted its partner or reply");
  }
  return { personaId, reply };
}

function getThreadDefinition(personaId?: RewindPersonaId): {
  personaId: RewindPersonaId | null;
  threadKey: string;
  title: string;
  type: RewindChatType;
} {
  if (!personaId) {
    return {
      personaId: null,
      threadKey: "group",
      title: "General",
      type: RewindChatType.GROUP,
    };
  }
  return {
    personaId,
    threadKey: `partner:${personaId}`,
    title: PERSONA_NAMES[personaId],
    type: RewindChatType.PARTNER,
  };
}

async function ensureChat(
  userId: string,
  personaId?: RewindPersonaId,
): Promise<RewindChat> {
  const definition = getThreadDefinition(personaId);
  return prisma.rewindChat.upsert({
    create: { ...definition, userId },
    update: {},
    where: {
      userId_threadKey: { threadKey: definition.threadKey, userId },
    },
  });
}

export async function ensureDefaultRewindChats(
  userId: string,
): Promise<SerializedRewindChat[]> {
  await Promise.all([
    ensureChat(userId),
    ...REWIND_PERSONAS.map((personaId) => ensureChat(userId, personaId)),
  ]);
  const chats = await prisma.rewindChat.findMany({
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "asc" }],
    where: { archivedAt: null, userId },
  });
  return chats.map((chat) => serializeChat(chat, chat.messages[0] ?? null));
}

export async function listRewindChatMessages(params: {
  chatId: string;
  cursor?: string;
  limit: number;
  userId: string;
}): Promise<{
  chat: SerializedRewindChat;
  items: SerializedRewindChatMessage[];
  nextCursor: string | null;
}> {
  const chat = await prisma.rewindChat.findFirst({
    where: { id: params.chatId, userId: params.userId },
  });
  if (!chat) throw new RewindChatError("CHAT_NOT_FOUND", "Chat not found", 404);
  if (params.cursor) {
    const cursorMessage = await prisma.rewindChatMessage.findFirst({
      select: { id: true },
      where: { chatId: chat.id, id: params.cursor, userId: params.userId },
    });
    if (!cursorMessage) {
      throw new RewindChatError("INVALID_CURSOR", "Invalid chat cursor");
    }
  }
  const rows = await prisma.rewindChatMessage.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: params.cursor ? 1 : 0,
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor } } : {}),
    where: { chatId: chat.id },
  });
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  return {
    chat: serializeChat(chat, rows[0] ?? null),
    items: [...pageRows].reverse().map(serializeMessage),
    nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
  };
}

function formatRecentMessages(messages: RewindChatMessage[]): string {
  return messages
    .map((message) => {
      let speaker = "Partner";
      if (message.role === RewindChatMessageRole.USER) {
        speaker = "User";
      } else if (isPersonaId(message.personaId)) {
        speaker = PERSONA_NAMES[message.personaId];
      }
      return `${speaker}: ${message.content}`;
    })
    .join("\n");
}

async function generateChatReply(params: {
  chat: RewindChat;
  content: string;
  mentions: RewindPersonaId[];
  timezone: string;
  userId: string;
}): Promise<GeneratedChatReply> {
  if (!Env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  
  
  const [messages, user, storedObservationContext] = await Promise.all([
    prisma.rewindChatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      where: { chatId: params.chat.id },
    }),
    prisma.user.findUnique({
      select: {
        firstName: true,
        rewindPersonalizationEnabled: true,
        username: true,
      },
      where: { id: params.userId },
    }),
    getRecentObservationContext(params.userId),
  ]);
  let personalContext = "";
  if (user?.rewindPersonalizationEnabled) {
    personalContext = await loadRewindPersonalContext(
      params.userId,
      params.timezone,
      `chat:${params.chat.id}`,
    )
      .then(formatRewindPersonalContext)
      .catch((error: unknown) => {
        logger.warn("Rewind chat personal context unavailable", {
          chatId: params.chat.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          userId: params.userId,
        });
        return "";
      });
  }
  const observationContext = user?.rewindPersonalizationEnabled
    ? storedObservationContext
    : "";
  const fixedPersona = isPersonaId(params.chat.personaId)
    ? params.chat.personaId
    : params.mentions[0];
  const partnerDirection = fixedPersona
    ? `Reply only as ${PERSONA_NAMES[fixedPersona]}.`
    : "Choose exactly one partner whose perspective best fits the user’s latest message.";
  const personaDescriptions = REWIND_PERSONAS.map(
    (personaId) => `${PERSONA_NAMES[personaId]}: ${PERSONA_PROMPTS[personaId]}`,
  ).join("\n");
  const client = new GoogleGenAI({ apiKey: Env.GEMINI_API_KEY });
  const response = await client.models.generateContent({
    contents: [
      {
        parts: [
          {
            text:
              `You are responding in Vybaa Rewind text chat. ${partnerDirection} ` +
              `Be natural, concise, emotionally perceptive, and grounded. Respond like a trusted friend, not a clinician. ` +
              `Do not diagnose, invent facts, expose hidden context, or claim an action was completed. Ask at most one useful question.\n\n` +
              `Partners:\n${personaDescriptions}\n\n` +
              `User name: ${user?.firstName ?? user?.username ?? "there"}\n` +
              `Timezone: ${params.timezone}\n\n` +
              (observationContext
                ? `Recent grounded observations:\n${observationContext}\n\n`
                : "") +
              (personalContext ? `${personalContext}\n\n` : "") +
              `Recent chat:\n${formatRecentMessages([...messages].reverse())}\n\n` +
              `Latest message:\n${params.content}`,
          },
        ],
        role: "user",
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        properties: {
          personaId: { enum: REWIND_PERSONAS, type: Type.STRING },
          reply: { type: Type.STRING },
        },
        required: ["personaId", "reply"],
        type: Type.OBJECT,
      },
      temperature: 0.55,
    },
    model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.5-flash",
  });
  if (!response.text) throw new Error("Rewind chat response was empty");
  const generated = parseGeneratedReply(JSON.parse(response.text));
  return fixedPersona ? { ...generated, personaId: fixedPersona } : generated;
}

export async function sendRewindChatMessage(params: {
  chatId: string;
  content: string;
  idempotencyKey: string;
  timezone: string;
  userId: string;
}): Promise<{
  partnerMessage: SerializedRewindChatMessage;
  userMessage: SerializedRewindChatMessage;
}> {
  const chat = await prisma.rewindChat.findFirst({
    where: { archivedAt: null, id: params.chatId, userId: params.userId },
  });
  if (!chat) throw new RewindChatError("CHAT_NOT_FOUND", "Chat not found", 404);
  const content = normalizeContent(params.content);
  if (!content) {
    throw new RewindChatError("EMPTY_MESSAGE", "Message is required");
  }
  const userIdempotencyKey = getRewindChatMessageIdempotencyKey(
    params.userId,
    chat.id,
    params.idempotencyKey,
  );
  const existingUserMessage = await prisma.rewindChatMessage.findFirst({
    where: {
      chatId: chat.id,
      idempotencyKey: userIdempotencyKey,
      userId: params.userId,
    },
  });
  const replyIdempotencyKey = `${userIdempotencyKey}:reply`;
  const existingPartnerMessage = await prisma.rewindChatMessage.findFirst({
    where: {
      chatId: chat.id,
      idempotencyKey: replyIdempotencyKey,
      userId: params.userId,
    },
  });
  if (existingUserMessage && existingPartnerMessage) {
    return {
      partnerMessage: serializeMessage(existingPartnerMessage),
      userMessage: serializeMessage(existingUserMessage),
    };
  }

  const mentions = extractRewindMentions(content);
  const now = new Date();
  const localDateKey = DateTime.fromJSDate(now, {
    zone: params.timezone,
  }).toISODate();
  if (!localDateKey) throw new Error("Unable to resolve chat local date");
  const userMessage =
    existingUserMessage ??
    (await prisma.rewindChatMessage.upsert({
      create: {
        chatId: chat.id,
        content,
        idempotencyKey: userIdempotencyKey,
        localDateKey,
        mentions,
        role: RewindChatMessageRole.USER,
        userId: params.userId,
      },
      update: {},
      where: { idempotencyKey: userIdempotencyKey },
    }));
  await prisma.rewindChat.update({
    data: { lastMessageAt: now },
    where: { id: chat.id },
  });
  await recordActivitySignal({
    dedupeKey: `rewind-chat:${userMessage.id}`,
    description: `Text chat: ${content}`,
    eventType: "CHAT_MESSAGE",
    happenedAt: userMessage.createdAt,
    localDateKey,
    metadata: { chatId: chat.id, mentions },
    sourceId: userMessage.id,
    sourceType: ActivitySignalSourceType.REWIND_CHAT,
    timezone: params.timezone,
    userId: params.userId,
  });
  const generated = await generateChatReply({
    chat,
    content,
    mentions,
    timezone: params.timezone,
    userId: params.userId,
  });
  const partnerMessage =
    existingPartnerMessage ??
    (await prisma.rewindChatMessage.upsert({
      create: {
        chatId: chat.id,
        content: generated.reply,
        idempotencyKey: replyIdempotencyKey,
        localDateKey,
        mentions: [],
        personaId: generated.personaId,
        role: RewindChatMessageRole.PARTNER,
        userId: params.userId,
      },
      update: {},
      where: { idempotencyKey: replyIdempotencyKey },
    }));
  await prisma.rewindChat.update({
    data: { lastMessageAt: partnerMessage.createdAt },
    where: { id: chat.id },
  });
  return {
    partnerMessage: serializeMessage(partnerMessage),
    userMessage: serializeMessage(userMessage),
  };
}

export async function setRewindChatArchived(params: {
  archived: boolean;
  chatId: string;
  userId: string;
}): Promise<boolean> {
  const result = await prisma.rewindChat.updateMany({
    data: { archivedAt: params.archived ? new Date() : null },
    where: { id: params.chatId, userId: params.userId },
  });
  return result.count > 0;
}

export class RewindChatError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
