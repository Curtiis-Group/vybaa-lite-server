import type { Request } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { WebSocket } from "ws";
import type { RawData } from "ws";

import logger from "../utils/logger.util";
import { getJwtSecret, securityConfig } from "../utils/security-config.util";

const REALTIME_AUDIENCE = "vybaa-realtime";
const REALTIME_ISSUER = "vybaa-api";
const REALTIME_TOKEN_TTL = "5m";
const REALTIME_REDIS_CHANNEL = "vybaa:realtime";
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BUFFERED_BYTES = 1_000_000;
const instanceId = randomUUID();

type RealtimeSocketClaim = {
  exp: number;
  jti: string;
  type: "realtime_ws";
  userId: string;
};

type RealtimeEnvelope = {
  data: unknown;
  event: string;
  id: string;
  origin: string;
  sentAt: string;
  userId: string;
};

type SocketState = {
  alive: boolean;
  socket: WebSocket;
};

const connectionsByUser = new Map<string, Set<SocketState>>();
const consumedTokenIds = new Map<string, number>();
let redisPublisher: ReturnType<typeof createClient> | null = null;
let redisSubscriber: ReturnType<typeof createClient> | null = null;
let redisStartPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRealtimeEnvelope(value: unknown): value is RealtimeEnvelope {
  if (!isRecord(value)) return false;
  return (
    typeof value.event === "string" &&
    typeof value.id === "string" &&
    typeof value.origin === "string" &&
    typeof value.sentAt === "string" &&
    typeof value.userId === "string"
  );
}

function pruneConsumedTokens(nowSeconds: number): void {
  for (const [tokenId, expiresAt] of consumedTokenIds) {
    if (expiresAt <= nowSeconds) consumedTokenIds.delete(tokenId);
  }
}

function verifyRealtimeToken(token: string): RealtimeSocketClaim | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      audience: REALTIME_AUDIENCE,
      issuer: REALTIME_ISSUER,
    });
    if (!isRecord(decoded)) return null;
    if (
      decoded.type !== "realtime_ws" ||
      typeof decoded.userId !== "string" ||
      typeof decoded.jti !== "string" ||
      typeof decoded.exp !== "number"
    ) {
      return null;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    pruneConsumedTokens(nowSeconds);
    if (consumedTokenIds.has(decoded.jti)) return null;
    consumedTokenIds.set(decoded.jti, decoded.exp);
    return {
      exp: decoded.exp,
      jti: decoded.jti,
      type: "realtime_ws",
      userId: decoded.userId,
    };
  } catch {
    return null;
  }
}

function sendEnvelope(state: SocketState, envelope: RealtimeEnvelope): void {
  if (state.socket.readyState !== WebSocket.OPEN) return;
  if (state.socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
  state.socket.send(JSON.stringify(envelope));
}

function broadcastLocally(envelope: RealtimeEnvelope): void {
  const states = connectionsByUser.get(envelope.userId);
  if (!states) return;
  for (const state of states) sendEnvelope(state, envelope);
}

function removeConnection(userId: string, state: SocketState): void {
  const states = connectionsByUser.get(userId);
  if (!states) return;
  states.delete(state);
  if (!states.size) connectionsByUser.delete(userId);
}

function parseToken(req: Request): string | null {
  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

function getRawDataSize(raw: RawData): number {
  if (Array.isArray(raw)) {
    let size = 0;
    for (const part of raw) size += part.byteLength;
    return size;
  }
  return raw.byteLength;
}

function rawDataToString(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}

function handleRedisMessage(raw: string): void {
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isRealtimeEnvelope(envelope) || envelope.origin === instanceId) return;
    broadcastLocally(envelope);
  } catch (error: unknown) {
    logger.warn("Ignored malformed realtime broker event", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function connectRedisBroker(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;
  const publisher = createClient({ url: redisUrl });
  const subscriber = publisher.duplicate();
  publisher.on("error", (error: Error) => {
    logger.warn("Realtime Redis publisher error", { errorName: error.name });
  });
  subscriber.on("error", (error: Error) => {
    logger.warn("Realtime Redis subscriber error", { errorName: error.name });
  });
  await Promise.all([publisher.connect(), subscriber.connect()]);
  await subscriber.subscribe(REALTIME_REDIS_CHANNEL, handleRedisMessage);
  redisPublisher = publisher;
  redisSubscriber = subscriber;
  logger.info("First-party realtime broker connected");
}

export function createRealtimeSocketToken(userId: string): {
  token: string;
  wsUrl: string;
} {
  const token = jwt.sign({ type: "realtime_ws", userId }, getJwtSecret(), {
    audience: REALTIME_AUDIENCE,
    expiresIn: REALTIME_TOKEN_TTL,
    issuer: REALTIME_ISSUER,
    jwtid: randomUUID(),
  });
  return {
    token,
    wsUrl: "/api/v2/realtime/live",
  };
}

export async function startRealtimeWebSocketBroker(): Promise<void> {
  if (!redisStartPromise) {
    redisStartPromise = connectRedisBroker().catch((error: unknown) => {
      logger.warn("Realtime Redis broker unavailable; using local sockets", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }
  await redisStartPromise;
}

export async function publishUserRealtimeEvent(
  userId: string,
  event: string,
  data: unknown,
): Promise<void> {
  const envelope: RealtimeEnvelope = {
    data,
    event,
    id: randomUUID(),
    origin: instanceId,
    sentAt: new Date().toISOString(),
    userId,
  };
  broadcastLocally(envelope);
  if (redisPublisher?.isReady) {
    await redisPublisher.publish(
      REALTIME_REDIS_CHANNEL,
      JSON.stringify(envelope),
    );
  }
}

export function handleRealtimeConnection(
  socket: WebSocket,
  req: Request,
): void {
  const token = parseToken(req);
  const claim = token ? verifyRealtimeToken(token) : null;
  if (!claim) {
    socket.send(
      JSON.stringify({
        message: "Unauthorized realtime connection",
        type: "error",
      }),
    );
    socket.close(1008, "Unauthorized");
    return;
  }
  const existingStates = connectionsByUser.get(claim.userId) ?? new Set();
  if (existingStates.size >= securityConfig.realtimeMaxConnectionsPerUser) {
    socket.close(1008, "Connection limit reached");
    return;
  }
  const state: SocketState = { alive: true, socket };
  existingStates.add(state);
  connectionsByUser.set(claim.userId, existingStates);
  socket.send(JSON.stringify({ type: "ready" }));
  socket.on("pong", () => {
    state.alive = true;
  });
  socket.on("message", (raw) => {
    if (getRawDataSize(raw) > 1_024) {
      socket.close(1009, "Message too large");
      return;
    }
    try {
      const message: unknown = JSON.parse(rawDataToString(raw));
      if (isRecord(message) && message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      socket.close(1008, "Malformed message");
    }
  });
  socket.on("close", () => removeConnection(claim.userId, state));
  socket.on("error", () => removeConnection(claim.userId, state));
}

const heartbeat = setInterval(() => {
  for (const states of connectionsByUser.values()) {
    for (const state of states) {
      if (!state.alive) {
        state.socket.terminate();
        continue;
      }
      state.alive = false;
      state.socket.ping();
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeat.unref();

export async function stopRealtimeWebSocketBroker(): Promise<void> {
  clearInterval(heartbeat);
  for (const states of connectionsByUser.values()) {
    for (const state of states)
      state.socket.close(1001, "Server shutting down");
  }
  connectionsByUser.clear();
  await Promise.all([redisPublisher?.quit(), redisSubscriber?.quit()]);
  redisPublisher = null;
  redisSubscriber = null;
}
