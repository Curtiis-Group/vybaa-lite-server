"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheService = void 0;
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
class InMemoryCache {
    constructor() {
        this.store = new Map();
    }
    async get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }
    async set(key, value, ttlSeconds) {
        const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
        this.store.set(key, { value, expiresAt });
    }
    async del(key) {
        this.store.delete(key);
    }
}
let redisClient = null;
class RedisCache {
    constructor() {
        this.isReady = false;
        // Lazy require so that the app can still run in memory-only mode
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { createClient } = require("redis");
            const url = env_util_1.Env.REDIS_URL || process.env.REDIS_URL;
            if (!url) {
                logger_util_1.default.warn("[RedisCache] REDIS_URL not set; falling back to in-memory cache");
                return;
            }
            redisClient =
                redisClient ||
                    createClient({
                        url,
                    });
            redisClient.on("error", (err) => {
                logger_util_1.default.error("[RedisCache] Redis client error", { err });
            });
            redisClient.connect().then(() => {
                this.isReady = true;
                logger_util_1.default.info("[RedisCache] Connected to Redis");
            }, (err) => {
                logger_util_1.default.error("[RedisCache] Failed to connect to Redis", { err });
            });
        }
        catch (err) {
            logger_util_1.default.warn("[RedisCache] redis package not installed; falling back to in-memory cache");
        }
    }
    ensureReady() {
        if (!redisClient || !this.isReady) {
            return false;
        }
        return true;
    }
    async get(key) {
        if (!this.ensureReady())
            return null;
        const raw = await redisClient.get(key);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return raw;
        }
    }
    async set(key, value, ttlSeconds) {
        if (!this.ensureReady())
            return;
        const payload = typeof value === "string" ? value : JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
            await redisClient.set(key, payload, {
                EX: ttlSeconds,
            });
        }
        else {
            await redisClient.set(key, payload);
        }
    }
    async del(key) {
        if (!this.ensureReady())
            return;
        await redisClient.del(key);
    }
}
function createCacheService() {
    const strategy = env_util_1.Env.CACHE_STRATEGY ||
        process.env.CACHE_STRATEGY ||
        "memory";
    if (strategy === "redis") {
        const redisCache = new RedisCache();
        if (redisCache.ensureReady?.()) {
            logger_util_1.default.info("[Cache] Using Redis cache backend");
            return redisCache;
        }
        logger_util_1.default.warn("[Cache] Redis selected but not available; using memory cache");
    }
    logger_util_1.default.info("[Cache] Using in-memory cache backend");
    return new InMemoryCache();
}
exports.cacheService = createCacheService();
