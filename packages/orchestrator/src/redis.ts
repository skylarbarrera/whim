/**
 * Redis client wrapper
 * Provides typed methods for common operations and connection management
 */

import Redis from "ioredis";

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  retryDelayMs?: number;
}

/**
 * Redis client wrapper with typed methods for common operations
 */
export class RedisClient {
  private client: Redis;
  private keyPrefix: string;
  private connected = false;

  constructor(config: RedisConfig = {}) {
    const { url, keyPrefix = "whim:", ...options } = config;

    this.keyPrefix = keyPrefix;

    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * (options.retryDelayMs ?? 100), 3000);
        },
      });
    } else {
      this.client = new Redis({
        host: options.host ?? "localhost",
        port: options.port ?? 6379,
        password: options.password,
        db: options.db ?? 0,
        maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * (options.retryDelayMs ?? 100), 3000);
        },
      });
    }

    this.client.on("connect", () => {
      this.connected = true;
    });

    this.client.on("close", () => {
      this.connected = false;
    });

    this.client.on("error", (err) => {
      console.error("Redis error:", err.message);
    });
  }

  /**
   * Get the underlying Redis client
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Connect to Redis and verify connectivity
   */
  async connect(): Promise<void> {
    // ioredis connects automatically, but we verify with PING
    const pong = await this.client.ping();
    if (pong !== "PONG") {
      throw new Error("Failed to connect to Redis");
    }
    this.connected = true;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
    this.connected = false;
  }

  /**
   * Check if connected to Redis
   */
  isConnected(): boolean {
    return this.connected && this.client.status === "ready";
  }

  /**
   * Build a prefixed key
   */
  private key(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  // ============================================
  // String Operations
  // ============================================

  /**
   * Get a string value
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(this.key(key));
  }

  /**
   * Set a string value
   */
  async set(
    key: string,
    value: string,
    options?: { ex?: number; px?: number; nx?: boolean; xx?: boolean }
  ): Promise<"OK" | null> {
    const args: (string | number)[] = [this.key(key), value];

    if (options?.ex !== undefined) {
      args.push("EX", options.ex);
    }
    if (options?.px !== undefined) {
      args.push("PX", options.px);
    }
    if (options?.nx) {
      args.push("NX");
    }
    if (options?.xx) {
      args.push("XX");
    }

    const result = await this.client.set(...(args as [string, string]));
    return result as "OK" | null;
  }

  /**
   * Delete one or more keys
   */
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys.map((k) => this.key(k)));
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(this.key(key));
    return count > 0;
  }

  // ============================================
  // Numeric Operations
  // ============================================

  /**
   * Increment a key's value
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(this.key(key));
  }

  /**
   * Increment a key's value by a specific amount
   */
  async incrBy(key: string, amount: number): Promise<number> {
    return this.client.incrby(this.key(key), amount);
  }

  /**
   * Decrement a key's value
   */
  async decr(key: string): Promise<number> {
    return this.client.decr(this.key(key));
  }

  /**
   * Decrement a key's value by a specific amount
   */
  async decrBy(key: string, amount: number): Promise<number> {
    return this.client.decrby(this.key(key), amount);
  }

  // ============================================
  // Expiration Operations
  // ============================================

  /**
   * Set a key's expiration in seconds
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(this.key(key), seconds);
    return result === 1;
  }

  /**
   * Set a key's expiration as a Unix timestamp
   */
  async expireAt(key: string, timestamp: number): Promise<boolean> {
    const result = await this.client.expireat(this.key(key), timestamp);
    return result === 1;
  }

  /**
   * Get a key's remaining TTL in seconds
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(this.key(key));
  }

  /**
   * Remove a key's expiration
   */
  async persist(key: string): Promise<boolean> {
    const result = await this.client.persist(this.key(key));
    return result === 1;
  }

  // ============================================
  // Hash Operations
  // ============================================

  /**
   * Set a hash field
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(this.key(key), field, value);
  }

  /**
   * Set multiple hash fields
   */
  async hmset(key: string, data: Record<string, string>): Promise<"OK"> {
    return this.client.hmset(this.key(key), data);
  }

  /**
   * Get a hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(this.key(key), field);
  }

  /**
   * Get all hash fields and values
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(this.key(key));
  }

  /**
   * Delete hash fields
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(this.key(key), ...fields);
  }

  /**
   * Increment a hash field's numeric value
   */
  async hincrby(key: string, field: string, amount: number): Promise<number> {
    return this.client.hincrby(this.key(key), field, amount);
  }

  // ============================================
  // Set Operations
  // ============================================

  /**
   * Add members to a set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(this.key(key), ...members);
  }

  /**
   * Remove members from a set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(this.key(key), ...members);
  }

  /**
   * Check if a member exists in a set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(this.key(key), member);
    return result === 1;
  }

  /**
   * Get all members of a set
   */
  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(this.key(key));
  }

  /**
   * Get the number of members in a set
   */
  async scard(key: string): Promise<number> {
    return this.client.scard(this.key(key));
  }

  // ============================================
  // List Operations
  // ============================================

  /**
   * Push values to the left of a list
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(this.key(key), ...values);
  }

  /**
   * Push values to the right of a list
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(this.key(key), ...values);
  }

  /**
   * Pop a value from the left of a list
   */
  async lpop(key: string): Promise<string | null> {
    return this.client.lpop(this.key(key));
  }

  /**
   * Pop a value from the right of a list
   */
  async rpop(key: string): Promise<string | null> {
    return this.client.rpop(this.key(key));
  }

  /**
   * Get a range of elements from a list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(this.key(key), start, stop);
  }

  /**
   * Get the length of a list
   */
  async llen(key: string): Promise<number> {
    return this.client.llen(this.key(key));
  }

  // ============================================
  // JSON Operations (using strings)
  // ============================================

  /**
   * Get a JSON value
   */
  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (value === null) return null;
    return JSON.parse(value) as T;
  }

  /**
   * Set a JSON value
   */
  async setJson<T>(
    key: string,
    value: T,
    options?: { ex?: number }
  ): Promise<"OK" | null> {
    return this.set(key, JSON.stringify(value), options);
  }

  // ============================================
  // Pub/Sub Operations
  // ============================================

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(this.key(channel), message);
  }
}

/**
 * Create a RedisClient instance from environment variables
 */
export function createRedisClient(): RedisClient {
  const url = process.env.REDIS_URL || "redis://localhost:6380";

  return new RedisClient({
    url,
    keyPrefix: "whim:",
  });
}
