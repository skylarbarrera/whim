/**
 * RateLimiter Tests
 * Uses a mock Redis client to test rate limiting logic
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { RateLimiter } from "./rate-limits.js";
import type { RedisClient } from "./redis.js";

/**
 * Mock Redis client for testing
 */
class MockRedisClient {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(`whim:${key}`) ?? null;
  }

  async set(key: string, value: string): Promise<"OK" | null> {
    this.store.set(`whim:${key}`, value);
    return "OK";
  }

  async incr(key: string): Promise<number> {
    const prefixedKey = `whim:${key}`;
    const current = parseInt(this.store.get(prefixedKey) ?? "0", 10);
    const newValue = current + 1;
    this.store.set(prefixedKey, newValue.toString());
    return newValue;
  }

  async decr(key: string): Promise<number> {
    const prefixedKey = `whim:${key}`;
    const current = parseInt(this.store.get(prefixedKey) ?? "0", 10);
    const newValue = current - 1;
    this.store.set(prefixedKey, newValue.toString());
    return newValue;
  }

  // Helper to set values directly for testing
  _set(key: string, value: string): void {
    this.store.set(`whim:${key}`, value);
  }

  // Helper to clear store
  _clear(): void {
    this.store.clear();
  }
}

describe("RateLimiter", () => {
  let mockRedis: MockRedisClient;
  let rateLimiter: RateLimiter;
  let mockActiveWorkerCount: number;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    mockActiveWorkerCount = 0;
    rateLimiter = new RateLimiter(mockRedis as unknown as RedisClient, {
      maxWorkers: 2,
      dailyBudget: 100,
      cooldownSeconds: 60,
      getActiveWorkerCount: async () => mockActiveWorkerCount,
    });
  });

  describe("canSpawnWorker", () => {
    test("returns true when under all limits", async () => {
      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(true);
    });

    test("returns false when at max workers", async () => {
      mockActiveWorkerCount = 2;
      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(false);
    });

    test("returns false when over max workers", async () => {
      mockActiveWorkerCount = 5;
      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(false);
    });

    test("returns false during cooldown period", async () => {
      // Set last spawn to 30 seconds ago (cooldown is 60s)
      const thirtySecondsAgo = Date.now() - 30 * 1000;
      mockRedis._set("rate:last_spawn", thirtySecondsAgo.toString());

      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(false);
    });

    test("returns true after cooldown expires", async () => {
      // Set last spawn to 90 seconds ago (cooldown is 60s)
      const ninetySecondsAgo = Date.now() - 90 * 1000;
      mockRedis._set("rate:last_spawn", ninetySecondsAgo.toString());

      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(true);
    });

    test("returns false when daily budget exhausted", async () => {
      // Set today's date to prevent reset
      const today = new Date().toISOString().split("T")[0]!;
      mockRedis._set("rate:daily_reset_date", today);
      mockRedis._set("rate:daily_iterations", "100");

      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(false);
    });

    test("returns false when daily budget exceeded", async () => {
      const today = new Date().toISOString().split("T")[0]!;
      mockRedis._set("rate:daily_reset_date", today);
      mockRedis._set("rate:daily_iterations", "150");

      const result = await rateLimiter.canSpawnWorker();
      expect(result).toBe(false);
    });
  });

  describe("recordSpawn", () => {
    test("sets last spawn timestamp", async () => {
      const before = Date.now();
      await rateLimiter.recordSpawn();
      const after = Date.now();

      const status = await rateLimiter.getStatus();
      expect(status.lastSpawn).not.toBeNull();
      expect(status.lastSpawn!.getTime()).toBeGreaterThanOrEqual(before);
      expect(status.lastSpawn!.getTime()).toBeLessThanOrEqual(after);
    });

    test("activeWorkers comes from DB function, not Redis", async () => {
      // Active workers are tracked via DB, not Redis
      mockActiveWorkerCount = 3;
      await rateLimiter.recordSpawn();

      const status = await rateLimiter.getStatus();
      // recordSpawn doesn't change activeWorkers - that comes from DB
      expect(status.activeWorkers).toBe(3);
    });
  });

  describe("recordWorkerDone", () => {
    test("is a no-op since active workers tracked in DB", async () => {
      // Active worker count is derived from DB workers table status
      // recordWorkerDone is a no-op - just verify it doesn't throw
      mockActiveWorkerCount = 2;
      await rateLimiter.recordWorkerDone();

      const status = await rateLimiter.getStatus();
      // Count unchanged - comes from mock function
      expect(status.activeWorkers).toBe(2);
    });
  });

  describe("recordIteration", () => {
    test("increments daily iteration count", async () => {
      const today = new Date().toISOString().split("T")[0]!;
      mockRedis._set("rate:daily_reset_date", today);

      await rateLimiter.recordIteration();
      await rateLimiter.recordIteration();
      await rateLimiter.recordIteration();

      const status = await rateLimiter.getStatus();
      expect(status.iterationsToday).toBe(3);
    });
  });

  describe("checkDailyReset", () => {
    test("resets iterations on new day", async () => {
      // Set yesterday's date
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]!;
      mockRedis._set("rate:daily_reset_date", yesterday);
      mockRedis._set("rate:daily_iterations", "50");

      await rateLimiter.checkDailyReset();

      const status = await rateLimiter.getStatus();
      expect(status.iterationsToday).toBe(0);
    });

    test("does not reset on same day", async () => {
      const today = new Date().toISOString().split("T")[0]!;
      mockRedis._set("rate:daily_reset_date", today);
      mockRedis._set("rate:daily_iterations", "50");

      await rateLimiter.checkDailyReset();

      const status = await rateLimiter.getStatus();
      expect(status.iterationsToday).toBe(50);
    });
  });

  describe("getStatus", () => {
    test("returns correct initial status", async () => {
      const status = await rateLimiter.getStatus();

      expect(status.iterationsToday).toBe(0);
      expect(status.dailyBudget).toBe(100);
      expect(status.lastSpawn).toBeNull();
      expect(status.cooldownSeconds).toBe(60);
      expect(status.activeWorkers).toBe(0);
      expect(status.maxWorkers).toBe(2);
      expect(status.canSpawn).toBe(true);
    });

    test("returns correct status after activity", async () => {
      const today = new Date().toISOString().split("T")[0]!;
      mockRedis._set("rate:daily_reset_date", today);
      mockRedis._set("rate:daily_iterations", "25");
      mockRedis._set("rate:last_spawn", Date.now().toString());
      mockActiveWorkerCount = 1; // Active workers come from DB function

      const status = await rateLimiter.getStatus();

      expect(status.activeWorkers).toBe(1);
      expect(status.iterationsToday).toBe(25);
      expect(status.lastSpawn).not.toBeNull();
      // Should be in cooldown
      expect(status.canSpawn).toBe(false);
    });
  });
});
