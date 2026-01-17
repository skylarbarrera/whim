/**
 * Rate Limiter
 * Manages worker spawn rate limiting and daily iteration budgets
 */

import type { RedisClient } from "./redis.js";

/**
 * Function to get active worker count from database (source of truth)
 */
export type GetActiveWorkerCountFn = () => Promise<number>;

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  maxWorkers: number;
  dailyBudget: number;
  cooldownSeconds: number;
  /** Optional function to get active worker count from DB (prevents counter drift) */
  getActiveWorkerCount?: GetActiveWorkerCountFn;
}

/**
 * Rate limit status response
 */
export interface RateLimitStatus {
  iterationsToday: number;
  dailyBudget: number;
  lastSpawn: Date | null;
  cooldownSeconds: number;
  activeWorkers: number;
  maxWorkers: number;
  canSpawn: boolean;
}

/**
 * Redis key names for rate limiting
 * Note: Active worker count comes from DB (source of truth), not Redis
 */
const KEYS = {
  lastSpawn: "rate:last_spawn",
  dailyIterations: "rate:daily_iterations",
  dailyResetDate: "rate:daily_reset_date",
} as const;

/**
 * Get today's date as YYYY-MM-DD string
 */
function getTodayString(): string {
  const parts = new Date().toISOString().split("T");
  return parts[0] ?? "";
}

/**
 * Rate Limiter for controlling worker spawns and iteration budgets
 */
export class RateLimiter {
  private config: Omit<RateLimitConfig, 'getActiveWorkerCount'>;
  private getActiveWorkerCountFn?: GetActiveWorkerCountFn;

  constructor(
    private redis: RedisClient,
    config?: Partial<RateLimitConfig>
  ) {
    this.config = {
      maxWorkers: config?.maxWorkers ?? parseInt(process.env.MAX_WORKERS ?? "2", 10),
      dailyBudget: config?.dailyBudget ?? parseInt(process.env.DAILY_BUDGET ?? "200", 10),
      cooldownSeconds: config?.cooldownSeconds ?? parseInt(process.env.COOLDOWN_SECONDS ?? "60", 10),
    };
    // Store the DB-based worker count function if provided (prevents counter drift)
    this.getActiveWorkerCountFn = config?.getActiveWorkerCount;
  }

  /**
   * Check if spawning a new worker is allowed
   * Returns false if:
   * - At max worker capacity
   * - Within cooldown period from last spawn
   * - Daily iteration budget exhausted
   */
  async canSpawnWorker(): Promise<boolean> {
    // Check daily reset first
    await this.checkDailyReset();

    // Check active worker count
    const activeWorkers = await this.getActiveWorkerCount();
    if (activeWorkers >= this.config.maxWorkers) {
      return false;
    }

    // Check cooldown
    const lastSpawn = await this.getLastSpawn();
    if (lastSpawn) {
      const elapsed = (Date.now() - lastSpawn.getTime()) / 1000;
      if (elapsed < this.config.cooldownSeconds) {
        return false;
      }
    }

    // Check daily budget
    const iterationsToday = await this.getIterationsToday();
    if (iterationsToday >= this.config.dailyBudget) {
      return false;
    }

    return true;
  }

  /**
   * Record a worker spawn
   * Updates last spawn timestamp (active count tracked in DB)
   */
  async recordSpawn(): Promise<void> {
    await this.redis.set(KEYS.lastSpawn, Date.now().toString());
  }

  /**
   * Record worker completion
   * No-op: active count is tracked in DB via workers table status
   */
  async recordWorkerDone(): Promise<void> {
    // Active worker count is derived from DB (workers with status 'starting' or 'running')
    // No Redis counter to decrement
  }

  /**
   * Record an iteration for daily budget tracking
   */
  async recordIteration(): Promise<void> {
    await this.checkDailyReset();
    await this.redis.incr(KEYS.dailyIterations);
  }

  /**
   * Check and reset daily limits if it's a new day
   */
  async checkDailyReset(): Promise<void> {
    const today = getTodayString();
    const storedDate = await this.redis.get(KEYS.dailyResetDate);

    if (storedDate !== today) {
      // Reset daily counters
      await Promise.all([
        this.redis.set(KEYS.dailyIterations, "0"),
        this.redis.set(KEYS.dailyResetDate, today),
      ]);
    }
  }

  /**
   * Get current rate limit status
   */
  async getStatus(): Promise<RateLimitStatus> {
    await this.checkDailyReset();

    const [activeWorkers, iterationsToday, lastSpawn, canSpawn] = await Promise.all([
      this.getActiveWorkerCount(),
      this.getIterationsToday(),
      this.getLastSpawn(),
      this.canSpawnWorker(),
    ]);

    return {
      iterationsToday,
      dailyBudget: this.config.dailyBudget,
      lastSpawn,
      cooldownSeconds: this.config.cooldownSeconds,
      activeWorkers,
      maxWorkers: this.config.maxWorkers,
      canSpawn,
    };
  }

  /**
   * Get the current active worker count from DB (source of truth)
   */
  private async getActiveWorkerCount(): Promise<number> {
    if (this.getActiveWorkerCountFn) {
      return this.getActiveWorkerCountFn();
    }
    // If no DB function provided, return 0 (should not happen in production)
    console.warn("RateLimiter: No getActiveWorkerCount function provided, returning 0");
    return 0;
  }

  /**
   * Get today's iteration count
   */
  private async getIterationsToday(): Promise<number> {
    const value = await this.redis.get(KEYS.dailyIterations);
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Get the last spawn timestamp
   */
  private async getLastSpawn(): Promise<Date | null> {
    const value = await this.redis.get(KEYS.lastSpawn);
    return value ? new Date(parseInt(value, 10)) : null;
  }
}

/**
 * Create a RateLimiter instance with environment-based config
 */
export function createRateLimiter(redis: RedisClient): RateLimiter {
  return new RateLimiter(redis);
}
