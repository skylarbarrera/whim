/**
 * ConflictDetector Tests
 * Uses a mock Database to test file lock management
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { ConflictDetector } from "./conflicts.js";
import type { Database } from "./db.js";

interface MockFileLock {
  id: string;
  workerId: string;
  filePath: string;
  acquiredAt: Date;
}

/**
 * Mock Database for testing file locks
 */
class MockDatabase {
  private locks: Map<string, MockFileLock> = new Map();
  private idCounter = 0;

  async query<T>(
    text: string,
    values?: unknown[]
  ): Promise<T[]> {
    // Handle SELECT by worker_id
    if (text.includes("WHERE worker_id = $1") && values) {
      const workerId = values[0] as string;
      const results: MockFileLock[] = [];
      for (const lock of this.locks.values()) {
        if (lock.workerId === workerId) {
          results.push(lock);
        }
      }
      return results as T[];
    }
    return [];
  }

  async queryOne<T>(
    text: string,
    values?: unknown[]
  ): Promise<T | null> {
    // Handle INSERT ... ON CONFLICT DO NOTHING RETURNING
    if (text.includes("INSERT INTO file_locks") && text.includes("ON CONFLICT") && text.includes("RETURNING") && values) {
      const workerId = values[0] as string;
      const filePath = values[1] as string;

      // Check if already locked (DO NOTHING case)
      if (this.locks.has(filePath)) {
        return null;
      }

      // Insert succeeded
      this.idCounter++;
      this.locks.set(filePath, {
        id: `lock-${this.idCounter}`,
        workerId,
        filePath,
        acquiredAt: new Date(),
      });
      return { workerId } as T;
    }

    // Handle SELECT by file_path
    if (text.includes("WHERE file_path = $1") && values) {
      const filePath = values[0] as string;
      const lock = this.locks.get(filePath);
      return (lock ?? null) as T | null;
    }
    return null;
  }

  async execute(
    text: string,
    values?: unknown[]
  ): Promise<{ rowCount: number }> {
    // Handle INSERT
    if (text.includes("INSERT INTO file_locks") && values) {
      const workerId = values[0] as string;
      const filePath = values[1] as string;

      // Check if already locked (simulate UNIQUE constraint)
      if (this.locks.has(filePath)) {
        const error = new Error("duplicate key value violates unique constraint") as Error & { code: string };
        error.code = "23505";
        throw error;
      }

      this.idCounter++;
      this.locks.set(filePath, {
        id: `lock-${this.idCounter}`,
        workerId,
        filePath,
        acquiredAt: new Date(),
      });
      return { rowCount: 1 };
    }

    // Handle DELETE by worker_id and file_path IN (...)
    if (text.includes("DELETE FROM file_locks WHERE worker_id = $1 AND file_path IN") && values) {
      const workerId = values[0] as string;
      const filePaths = values.slice(1) as string[];
      let deleted = 0;
      for (const filePath of filePaths) {
        const lock = this.locks.get(filePath);
        if (lock && lock.workerId === workerId) {
          this.locks.delete(filePath);
          deleted++;
        }
      }
      return { rowCount: deleted };
    }

    // Handle DELETE by worker_id only (releaseAllLocks)
    if (text.includes("DELETE FROM file_locks WHERE worker_id = $1") && values) {
      const workerId = values[0] as string;
      let deleted = 0;
      for (const [filePath, lock] of this.locks) {
        if (lock.workerId === workerId) {
          this.locks.delete(filePath);
          deleted++;
        }
      }
      return { rowCount: deleted };
    }

    return { rowCount: 0 };
  }

  // Test helpers
  _setLock(workerId: string, filePath: string): void {
    this.idCounter++;
    this.locks.set(filePath, {
      id: `lock-${this.idCounter}`,
      workerId,
      filePath,
      acquiredAt: new Date(),
    });
  }

  _getLock(filePath: string): MockFileLock | undefined {
    return this.locks.get(filePath);
  }

  _clear(): void {
    this.locks.clear();
    this.idCounter = 0;
  }
}

describe("ConflictDetector", () => {
  let mockDb: MockDatabase;
  let detector: ConflictDetector;

  const WORKER_1 = "worker-1-uuid";
  const WORKER_2 = "worker-2-uuid";

  beforeEach(() => {
    mockDb = new MockDatabase();
    detector = new ConflictDetector(mockDb as unknown as Database);
  });

  describe("acquireLocks", () => {
    test("acquires locks on free files", async () => {
      const result = await detector.acquireLocks(WORKER_1, [
        "src/foo.ts",
        "src/bar.ts",
      ]);

      expect(result.acquired).toEqual(["src/foo.ts", "src/bar.ts"]);
      expect(result.blocked).toEqual([]);
    });

    test("returns empty arrays for empty file list", async () => {
      const result = await detector.acquireLocks(WORKER_1, []);

      expect(result.acquired).toEqual([]);
      expect(result.blocked).toEqual([]);
    });

    test("blocks on files locked by another worker", async () => {
      // Worker 2 has a lock on bar.ts
      mockDb._setLock(WORKER_2, "src/bar.ts");

      const result = await detector.acquireLocks(WORKER_1, [
        "src/foo.ts",
        "src/bar.ts",
      ]);

      expect(result.acquired).toEqual(["src/foo.ts"]);
      expect(result.blocked).toEqual(["src/bar.ts"]);
    });

    test("is idempotent - re-acquiring own locks succeeds", async () => {
      // First acquisition
      await detector.acquireLocks(WORKER_1, ["src/foo.ts"]);

      // Second acquisition of same file by same worker
      const result = await detector.acquireLocks(WORKER_1, ["src/foo.ts"]);

      expect(result.acquired).toEqual(["src/foo.ts"]);
      expect(result.blocked).toEqual([]);
    });

    test("handles mixed acquired and blocked files", async () => {
      mockDb._setLock(WORKER_2, "src/a.ts");
      mockDb._setLock(WORKER_2, "src/c.ts");

      const result = await detector.acquireLocks(WORKER_1, [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
      ]);

      expect(result.acquired).toEqual(["src/b.ts", "src/d.ts"]);
      expect(result.blocked).toEqual(["src/a.ts", "src/c.ts"]);
    });
  });

  describe("releaseLocks", () => {
    test("releases owned locks", async () => {
      mockDb._setLock(WORKER_1, "src/foo.ts");
      mockDb._setLock(WORKER_1, "src/bar.ts");

      await detector.releaseLocks(WORKER_1, ["src/foo.ts"]);

      expect(mockDb._getLock("src/foo.ts")).toBeUndefined();
      expect(mockDb._getLock("src/bar.ts")).toBeDefined();
    });

    test("does nothing for empty file list", async () => {
      mockDb._setLock(WORKER_1, "src/foo.ts");

      await detector.releaseLocks(WORKER_1, []);

      expect(mockDb._getLock("src/foo.ts")).toBeDefined();
    });

    test("ignores locks owned by other workers", async () => {
      mockDb._setLock(WORKER_2, "src/other.ts");

      await detector.releaseLocks(WORKER_1, ["src/other.ts"]);

      expect(mockDb._getLock("src/other.ts")).toBeDefined();
    });

    test("ignores non-existent locks", async () => {
      // Should not throw
      await detector.releaseLocks(WORKER_1, ["src/nonexistent.ts"]);
    });
  });

  describe("releaseAllLocks", () => {
    test("releases all locks for a worker", async () => {
      mockDb._setLock(WORKER_1, "src/a.ts");
      mockDb._setLock(WORKER_1, "src/b.ts");
      mockDb._setLock(WORKER_1, "src/c.ts");
      mockDb._setLock(WORKER_2, "src/other.ts");

      await detector.releaseAllLocks(WORKER_1);

      expect(mockDb._getLock("src/a.ts")).toBeUndefined();
      expect(mockDb._getLock("src/b.ts")).toBeUndefined();
      expect(mockDb._getLock("src/c.ts")).toBeUndefined();
      expect(mockDb._getLock("src/other.ts")).toBeDefined();
    });

    test("does nothing if worker has no locks", async () => {
      mockDb._setLock(WORKER_2, "src/other.ts");

      await detector.releaseAllLocks(WORKER_1);

      expect(mockDb._getLock("src/other.ts")).toBeDefined();
    });
  });

  describe("getLocksForWorker", () => {
    test("returns all locks for a worker", async () => {
      mockDb._setLock(WORKER_1, "src/a.ts");
      mockDb._setLock(WORKER_1, "src/b.ts");
      mockDb._setLock(WORKER_2, "src/other.ts");

      const locks = await detector.getLocksForWorker(WORKER_1);

      expect(locks).toHaveLength(2);
      expect(locks.map((l) => l.filePath).sort()).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    });

    test("returns empty array if worker has no locks", async () => {
      const locks = await detector.getLocksForWorker(WORKER_1);
      expect(locks).toEqual([]);
    });
  });

  describe("getLockHolder", () => {
    test("returns lock info for locked file", async () => {
      mockDb._setLock(WORKER_1, "src/foo.ts");

      const lock = await detector.getLockHolder("src/foo.ts");

      expect(lock).not.toBeNull();
      expect(lock!.workerId).toBe(WORKER_1);
      expect(lock!.filePath).toBe("src/foo.ts");
    });

    test("returns null for unlocked file", async () => {
      const lock = await detector.getLockHolder("src/nonexistent.ts");
      expect(lock).toBeNull();
    });
  });
});
