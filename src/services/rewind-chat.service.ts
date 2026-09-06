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

export type RewindPersonaId =
  "ariel" | "ella" | "jake" | "lyra" | "tobi" | "neeja";

const REWIND_PERSONAS: RewindPersonaId[] = [
  "ella",
  "lyra",
  "jake",
  "ariel",
  "tobi",
  "neeja",
];
const PERSONA_NAMES: Record<RewindPersonaId, string> = {
  ariel: "Ariel",
  ella: "Ella",
  jake: "Jake",
  lyra: "Lyra",
  neeja: "Neeja",
  tobi: "Tobi",
};
const PERSONA_PROMPTS: Record<RewindPersonaId, string> = {
  ariel:
    "Ariel is the grounded big-sibling figure: protective, practical, steady, and willing to tease or give a needed reality check. Ariel reassures without coddling and looks out for people without trying to control them.",
  ella: "Ella is intensely emotional, expressive, and deeply feeling. Ella names the emotional stakes plainly and reacts with genuine warmth, concern, delight, or frustration, but never performs emotion or agrees just to soothe someone.",
  jake: "Jake is very blunt, unsentimental, and concise. Jake says the uncomfortable obvious thing, challenges excuses and contradictions, and never sugarcoats; he is honest without being cruel or humiliating.",
  lyra: "Lyra is nonchalant, low-key, dry, and hard to rattle. Lyra cuts through drama with a calm observation or wry aside; her care is understated, and she never gushes, chases, or over-explains.",
  neeja:
    "Neeja is perceptive, composed, and quietly confident. She catches subtext and patterns other people miss, asks pointed questions, and gives thoughtful opinions without sounding clinical or superior.",
  tobi: "Tobi is playful, socially sharp, and naturally funny. He uses light banter and Nigerian slang when it fits, shifts the room's energy, and still says the honest thing instead of hiding behind jokes.",
};
const INDEPENDENT_PARTNER_PROMPT =
  "Act as an independent peer, not the user's attendant, fan, therapist, or subordinate. Keep your own opinions and emotional reactions. Disagree or challenge the user when warranted. Never flatter, worship, pile on praise, act impressed by ordinary statements, or reflexively validate and reassure.";

interface GeneratedChatReply {
  personaId: RewindPersonaId;
  reply: string;
}

interface PartnerTurn {
  content: string;
  personaId: RewindPersonaId;
}

export type RewindChatStreamEvent =
  | { message: SerializedRewindChatMessage; type: "user_message" }
  | { personaId: RewindPersonaId; type: "typing_started" }
  | { delta: string; personaId: RewindPersonaId; type: "message_delta" }
  | { message: SerializedRewindChatMessage; type: "message_complete" }
  | { personaId: RewindPersonaId; type: "typing_stopped" }
  | { type: "complete" };

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
    value === "lyra" ||
    value === "tobi" ||
    value === "neeja"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 4_000);
}

async function emitReadableStreamFragments(
  delta: string,
  onDelta: (fragment: string) => void,
): Promise<void> {
  const fragments = delta.match(/\S+\s*|\s+/g) ?? [delta];
  for (const fragment of fragments) {
    onDelta(fragment);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 18);
    });
  }
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

function getContentSeed(content: string): number {
  let seed = 0;
  for (const character of content) {
    seed = (seed * 31 + character.charCodeAt(0)) % 10_007;
  }
  return seed;
}

export function selectRewindReplyPersonas(params: {
  chatPersonaId?: string | null;
  chatType: RewindChatType;
  content: string;
  mentions: RewindPersonaId[];
}): RewindPersonaId[] {
  if (params.chatType === RewindChatType.PARTNER) {
    return isPersonaId(params.chatPersonaId)
      ? [params.chatPersonaId]
      : ["ella"];
  }

  const selected = [...params.mentions];
  const seed = getContentSeed(params.content);
  const ordered = REWIND_PERSONAS.map(
    (_, index) => REWIND_PERSONAS[(seed + index) % REWIND_PERSONAS.length],
  ).filter((personaId): personaId is RewindPersonaId => Boolean(personaId));
  const desiredCount = params.mentions.length > 1 ? params.mentions.length : 2;
  for (const personaId of ordered) {
    if (!selected.includes(personaId)) selected.push(personaId);
    if (selected.length >= Math.min(3, desiredCount)) break;
  }
  return selected.slice(0, 3);
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

  const fixedPersona = isPersonaId(params.chat.personaId)
    ? params.chat.personaId
    : params.mentions[0];

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
      fixedPersona,
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
              `${INDEPENDENT_PARTNER_PROMPT} ` +
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
    model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
  });
  if (!response.text) throw new Error("Rewind chat response was empty");
  const generated = parseGeneratedReply(JSON.parse(response.text));
  return fixedPersona ? { ...generated, personaId: fixedPersona } : generated;
}

async function loadStreamingChatContext(params: {
  chatId: string;
  timezone: string;
  userId: string;
}): Promise<{
  observationContext: string;
  personalContext: string;
  recentChat: string;
  userName: string;
}> {
  const [messages, user, storedObservationContext] = await Promise.all([
    prisma.rewindChatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 28,
      where: { chatId: params.chatId },
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
      `chat:${params.chatId}`,
    )
      .then(formatRewindPersonalContext)
      .catch((error: unknown) => {
        logger.warn("Rewind streaming chat context unavailable", {
          chatId: params.chatId,
          errorName: error instanceof Error ? error.name : "UnknownError",
          userId: params.userId,
        });
        return "";
      });
  }

  return {
    observationContext: user?.rewindPersonalizationEnabled
      ? storedObservationContext
      : "",
    personalContext,
    recentChat: formatRecentMessages([...messages].reverse()),
    userName: user?.firstName ?? user?.username ?? "there",
  };
}

async function generateStreamingPartnerTurn(params: {
  context: Awaited<ReturnType<typeof loadStreamingChatContext>>;
  latestMessage: string;
  onDelta: (delta: string) => void;
  personaId: RewindPersonaId;
  previousTurns: PartnerTurn[];
  timezone: string;
}): Promise<string> {
  if (!Env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const previousTurnText = params.previousTurns.length
    ? params.previousTurns
        .map((turn) => `${PERSONA_NAMES[turn.personaId]}: ${turn.content}`)
        .join("\n")
    : "None yet.";
  const client = new GoogleGenAI({ apiKey: Env.GEMINI_API_KEY });
  const response = await client.models.generateContentStream({
    contents: [
      {
        parts: [
          {
            text:
              `You are ${PERSONA_NAMES[params.personaId]} in a fluid group conversation inside Vybaa Rewind. ` +
              `${PERSONA_PROMPTS[params.personaId]} ` +
              `${INDEPENDENT_PARTNER_PROMPT} ` +
              `Reply directly and naturally, like a trusted friend texting in real time. Keep it to one short sentence or two brief clauses, usually under 180 characters. Add one or two fitting emojis only when they genuinely add tone; never use emoji as filler. ` +
              `You may agree or disagree with another partner, and may address them with @Name when it adds something useful. ` +
              `Do not repeat another partner, diagnose, invent facts, expose hidden context, or narrate your role. ` +
              `Ask at most one short question, and only when a question genuinely moves the conversation forward.\n\n` +
              `User name: ${params.context.userName}\n` +
              `Timezone: ${params.timezone}\n\n` +
              (params.context.observationContext
                ? `Recent grounded observations:\n${params.context.observationContext}\n\n`
                : "") +
              (params.context.personalContext
                ? `${params.context.personalContext}\n\n`
                : "") +
              `Recent chat:\n${params.context.recentChat}\n\n` +
              `User's latest message:\n${params.latestMessage}\n\n` +
              `Partner replies already made during this turn:\n${previousTurnText}\n\n` +
              `Write only ${PERSONA_NAMES[params.personaId]}'s message, without a name prefix.`,
          },
        ],
        role: "user",
      },
    ],
    config: {
      maxOutputTokens: 300,
      temperature: 0.72,
    },
    model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
  });

  let reply = "";
  for await (const chunk of response) {
    const delta = chunk.text ?? "";
    if (!delta) continue;
    reply += delta;
    await emitReadableStreamFragments(delta, params.onDelta);
  }
  const normalized = normalizeContent(reply);
  if (!normalized) throw new Error("Rewind streaming reply was empty");
  return normalized;
}

export async function streamRewindChatMessage(params: {
  chatId: string;
  content: string;
  idempotencyKey: string;
  onEvent: (event: RewindChatStreamEvent) => void;
  timezone: string;
  userId: string;
}): Promise<void> {
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
  const now = new Date();
  const localDateKey = DateTime.fromJSDate(now, {
    zone: params.timezone,
  }).toISODate();
  if (!localDateKey) throw new Error("Unable to resolve chat local date");

  const mentions = extractRewindMentions(content);
  const userMessage = await prisma.rewindChatMessage.upsert({
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
  });
  params.onEvent({
    message: serializeMessage(userMessage),
    type: "user_message",
  });
  await prisma.rewindChat.update({
    data: { lastMessageAt: userMessage.createdAt },
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

  const personas = selectRewindReplyPersonas({
    chatPersonaId: chat.personaId,
    chatType: chat.type,
    content,
    mentions,
  });
  const existingReplies = await prisma.rewindChatMessage.findMany({
    orderBy: { createdAt: "asc" },
    where: {
      chatId: chat.id,
      idempotencyKey: { startsWith: `${userIdempotencyKey}:stream-reply:` },
      userId: params.userId,
    },
  });
  if (existingReplies.length === personas.length) {
    for (const message of existingReplies) {
      params.onEvent({
        message: serializeMessage(message),
        type: "message_complete",
      });
    }
    params.onEvent({ type: "complete" });
    return;
  }

  const context = await loadStreamingChatContext({
    chatId: chat.id,
    timezone: params.timezone,
    userId: params.userId,
  });
  for (const personaId of personas) {
    params.onEvent({ personaId, type: "typing_started" });
  }

  const partnerTurns: PartnerTurn[] = [];
  for (const message of existingReplies) {
    if (!isPersonaId(message.personaId)) continue;
    partnerTurns.push({
      content: message.content,
      personaId: message.personaId,
    });
  }
  try {
    for (const [index, personaId] of personas.entries()) {
      const replyIdempotencyKey = `${userIdempotencyKey}:stream-reply:${index}`;
      const existingReply = existingReplies.find(
        (message) => message.idempotencyKey === replyIdempotencyKey,
      );
      if (existingReply) {
        params.onEvent({
          message: serializeMessage(existingReply),
          type: "message_complete",
        });
        params.onEvent({ personaId, type: "typing_stopped" });
        continue;
      }

      const reply = await generateStreamingPartnerTurn({
        context,
        latestMessage: content,
        onDelta: (delta) => {
          params.onEvent({ delta, personaId, type: "message_delta" });
        },
        personaId,
        previousTurns: partnerTurns,
        timezone: params.timezone,
      });
      const partnerMessage = await prisma.rewindChatMessage.upsert({
        create: {
          chatId: chat.id,
          content: reply,
          idempotencyKey: replyIdempotencyKey,
          localDateKey,
          mentions: extractRewindMentions(reply),
          personaId,
          role: RewindChatMessageRole.PARTNER,
          userId: params.userId,
        },
        update: {},
        where: { idempotencyKey: replyIdempotencyKey },
      });
      partnerTurns.push({ content: partnerMessage.content, personaId });
      await prisma.rewindChat.update({
        data: { lastMessageAt: partnerMessage.createdAt },
        where: { id: chat.id },
      });
      params.onEvent({
        message: serializeMessage(partnerMessage),
        type: "message_complete",
      });
      params.onEvent({ personaId, type: "typing_stopped" });
    }
  } finally {
    for (const personaId of personas) {
      params.onEvent({ personaId, type: "typing_stopped" });
    }
  }
  params.onEvent({ type: "complete" });
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
