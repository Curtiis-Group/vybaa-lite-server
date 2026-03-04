import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";

export interface CacheService {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

type InMemoryEntry = {
  value: unknown;
  expiresAt?: number; // epoch ms
};

class InMemoryCache implements CacheService {
  private store = new Map<string, InMemoryEntry>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;

    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

let redisClient: any = null;

class RedisCache implements CacheService {
  private isReady = false;

  constructor() {
    // Lazy require so that the app can still run in memory-only mode
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createClient } = require("redis") as typeof import("redis");
      const url = (Env as any).REDIS_URL || process.env.REDIS_URL;

      if (!url) {
        logger.warn(
          "[RedisCache] REDIS_URL not set; falling back to in-memory cache",
        );
        return;
      }

      redisClient =
        redisClient ||
        createClient({
          url,
        });

      redisClient.on("error", (err: unknown) => {
        logger.error("[RedisCache] Redis client error", { err });
      });

      redisClient.connect().then(
        () => {
          this.isReady = true;
          logger.info("[RedisCache] Connected to Redis");
        },
        (err: unknown) => {
          logger.error("[RedisCache] Failed to connect to Redis", { err });
        },
      );
    } catch (err) {
      logger.warn(
        "[RedisCache] redis package not installed; falling back to in-memory cache",
      );
    }
  }

  private ensureReady(): boolean {
    if (!redisClient || !this.isReady) {
      return false;
    }
    return true;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    if (!this.ensureReady()) return null;
    const raw = await redisClient.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.ensureReady()) return;
    const payload =
      typeof value === "string" ? (value as string) : JSON.stringify(value);

    if (ttlSeconds && ttlSeconds > 0) {
      await redisClient.set(key, payload, {
        EX: ttlSeconds,
      });
    } else {
      await redisClient.set(key, payload);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.ensureReady()) return;
    await redisClient.del(key);
  }
}

function createCacheService(): CacheService {
  const strategy =
    (Env as any).CACHE_STRATEGY ||
    process.env.CACHE_STRATEGY ||
    "memory";

  if (strategy === "redis") {
    const redisCache = new RedisCache();
    if ((redisCache as any).ensureReady?.()) {
      logger.info("[Cache] Using Redis cache backend");
      return redisCache;
    }
    logger.warn("[Cache] Redis selected but not available; using memory cache");
  }

  logger.info("[Cache] Using in-memory cache backend");
  return new InMemoryCache();
}

export const cacheService: CacheService = createCacheService();

