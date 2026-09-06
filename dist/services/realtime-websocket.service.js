"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRealtimeSocketToken = createRealtimeSocketToken;
exports.startRealtimeWebSocketBroker = startRealtimeWebSocketBroker;
exports.publishUserRealtimeEvent = publishUserRealtimeEvent;
exports.handleRealtimeConnection = handleRealtimeConnection;
exports.stopRealtimeWebSocketBroker = stopRealtimeWebSocketBroker;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_crypto_1 = require("node:crypto");
const redis_1 = require("redis");
const ws_1 = require("ws");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const security_config_util_1 = require("../utils/security-config.util");
const REALTIME_AUDIENCE = "vybaa-realtime";
const REALTIME_ISSUER = "vybaa-api";
const REALTIME_TOKEN_TTL = "5m";
const REALTIME_REDIS_CHANNEL = "vybaa:realtime";
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_BUFFERED_BYTES = 1000000;
const instanceId = (0, node_crypto_1.randomUUID)();
const connectionsByUser = new Map();
const consumedTokenIds = new Map();
let redisPublisher = null;
let redisSubscriber = null;
let redisStartPromise = null;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isRealtimeEnvelope(value) {
    if (!isRecord(value))
        return false;
    return (typeof value.event === "string" &&
        typeof value.id === "string" &&
        typeof value.origin === "string" &&
        typeof value.sentAt === "string" &&
        typeof value.userId === "string");
}
function pruneConsumedTokens(nowSeconds) {
    for (const [tokenId, expiresAt] of consumedTokenIds) {
        if (expiresAt <= nowSeconds)
            consumedTokenIds.delete(tokenId);
    }
}
function verifyRealtimeToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, (0, security_config_util_1.getJwtSecret)(), {
            audience: REALTIME_AUDIENCE,
            issuer: REALTIME_ISSUER,
        });
        if (!isRecord(decoded))
            return null;
        if (decoded.type !== "realtime_ws" ||
            typeof decoded.userId !== "string" ||
            typeof decoded.jti !== "string" ||
            typeof decoded.exp !== "number") {
            return null;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        pruneConsumedTokens(nowSeconds);
        if (consumedTokenIds.has(decoded.jti))
            return null;
        consumedTokenIds.set(decoded.jti, decoded.exp);
        return {
            exp: decoded.exp,
            jti: decoded.jti,
            type: "realtime_ws",
            userId: decoded.userId,
        };
    }
    catch {
        return null;
    }
}
function sendEnvelope(state, envelope) {
    if (state.socket.readyState !== ws_1.WebSocket.OPEN)
        return;
    if (state.socket.bufferedAmount > MAX_BUFFERED_BYTES)
        return;
    state.socket.send(JSON.stringify(envelope));
}
function broadcastLocally(envelope) {
    const states = connectionsByUser.get(envelope.userId);
    if (!states)
        return;
    for (const state of states)
        sendEnvelope(state, envelope);
}
function removeConnection(userId, state) {
    const states = connectionsByUser.get(userId);
    if (!states)
        return;
    states.delete(state);
    if (!states.size)
        connectionsByUser.delete(userId);
}
function parseToken(req) {
    try {
        const url = new URL(req.url, "http://localhost");
        return url.searchParams.get("token");
    }
    catch {
        return null;
    }
}
function getRawDataSize(raw) {
    if (Array.isArray(raw)) {
        let size = 0;
        for (const part of raw)
            size += part.byteLength;
        return size;
    }
    return raw.byteLength;
}
function rawDataToString(raw) {
    if (Array.isArray(raw))
        return Buffer.concat(raw).toString("utf8");
    if (raw instanceof ArrayBuffer)
        return Buffer.from(raw).toString("utf8");
    return raw.toString("utf8");
}
function handleRedisMessage(raw) {
    try {
        const envelope = JSON.parse(raw);
        if (!isRealtimeEnvelope(envelope) || envelope.origin === instanceId)
            return;
        broadcastLocally(envelope);
    }
    catch (error) {
        logger_util_1.default.warn("Ignored malformed realtime broker event", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
    }
}
async function connectRedisBroker() {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl)
        return;
    const publisher = (0, redis_1.createClient)({ url: redisUrl });
    const subscriber = publisher.duplicate();
    publisher.on("error", (error) => {
        logger_util_1.default.warn("Realtime Redis publisher error", { errorName: error.name });
    });
    subscriber.on("error", (error) => {
        logger_util_1.default.warn("Realtime Redis subscriber error", { errorName: error.name });
    });
    await Promise.all([publisher.connect(), subscriber.connect()]);
    await subscriber.subscribe(REALTIME_REDIS_CHANNEL, handleRedisMessage);
    redisPublisher = publisher;
    redisSubscriber = subscriber;
    logger_util_1.default.info("First-party realtime broker connected");
}
function createRealtimeSocketToken(userId) {
    const token = jsonwebtoken_1.default.sign({ type: "realtime_ws", userId }, (0, security_config_util_1.getJwtSecret)(), {
        audience: REALTIME_AUDIENCE,
        expiresIn: REALTIME_TOKEN_TTL,
        issuer: REALTIME_ISSUER,
        jwtid: (0, node_crypto_1.randomUUID)(),
    });
    return {
        token,
        wsUrl: "/api/v2/realtime/live",
    };
}
async function startRealtimeWebSocketBroker() {
    if (!redisStartPromise) {
        redisStartPromise = connectRedisBroker().catch((error) => {
            logger_util_1.default.warn("Realtime Redis broker unavailable; using local sockets", {
                errorName: error instanceof Error ? error.name : "UnknownError",
            });
        });
    }
    await redisStartPromise;
}
async function publishUserRealtimeEvent(userId, event, data) {
    const envelope = {
        data,
        event,
        id: (0, node_crypto_1.randomUUID)(),
        origin: instanceId,
        sentAt: new Date().toISOString(),
        userId,
    };
    broadcastLocally(envelope);
    if (redisPublisher?.isReady) {
        await redisPublisher.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(envelope));
    }
}
function handleRealtimeConnection(socket, req) {
    const token = parseToken(req);
    const claim = token ? verifyRealtimeToken(token) : null;
    if (!claim) {
        socket.send(JSON.stringify({
            message: "Unauthorized realtime connection",
            type: "error",
        }));
        socket.close(1008, "Unauthorized");
        return;
    }
    const existingStates = connectionsByUser.get(claim.userId) ?? new Set();
    if (existingStates.size >= security_config_util_1.securityConfig.realtimeMaxConnectionsPerUser) {
        socket.close(1008, "Connection limit reached");
        return;
    }
    const state = { alive: true, socket };
    existingStates.add(state);
    connectionsByUser.set(claim.userId, existingStates);
    socket.send(JSON.stringify({ type: "ready" }));
    socket.on("pong", () => {
        state.alive = true;
    });
    socket.on("message", (raw) => {
        if (getRawDataSize(raw) > 1024) {
            socket.close(1009, "Message too large");
            return;
        }
        try {
            const message = JSON.parse(rawDataToString(raw));
            if (isRecord(message) && message.type === "ping") {
                socket.send(JSON.stringify({ type: "pong" }));
            }
        }
        catch {
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
async function stopRealtimeWebSocketBroker() {
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
