/**
 * ConflictDetector - Manages file locks to prevent concurrent edits
 *
 * Uses PostgreSQL's UNIQUE constraint on file_path to ensure only one
 * worker can hold a lock on a file at a time.
 */

import type { Database } from "./db";

export interface LockResult {
  acquired: string[];
  blocked: string[];
}

export interface FileLock {
  id: string;
  workerId: string;
  filePath: string;
  acquiredAt: Date;
}

/**
 * ConflictDetector manages file locks across workers to prevent conflicts.
 *
 * File locks are stored in PostgreSQL with a UNIQUE constraint on file_path,
 * ensuring that only one worker can hold a lock on any given file.
 */
export class ConflictDetector {
  constructor(private db: Database) {}

  /**
   * Attempt to acquire locks on the specified files.
   *
   * For each file:
   * - If no lock exists, creates a lock for this worker
   * - If a lock exists for this worker, treats as already acquired (idempotent)
   * - If a lock exists for another worker, marks as blocked
   *
   * @param workerId - The worker requesting locks
   * @param files - Array of file paths to lock
   * @returns Object with arrays of acquired and blocked file paths
   */
  async acquireLocks(workerId: string, files: string[]): Promise<LockResult> {
    if (files.length === 0) {
      return { acquired: [], blocked: [] };
    }

    const acquired: string[] = [];
    const blocked: string[] = [];

    // Process each file individually to handle partial success
    for (const filePath of files) {
      const result = await this.tryAcquireLock(workerId, filePath);
      if (result.success) {
        acquired.push(filePath);
      } else {
        blocked.push(filePath);
      }
    }

    return { acquired, blocked };
  }

  /**
   * Try to acquire a single file lock.
   * Uses INSERT ... ON CONFLICT DO NOTHING for atomic lock acquisition.
   * No race condition - single statement handles both check and acquire.
   */
  private async tryAcquireLock(
    workerId: string,
    filePath: string
  ): Promise<{ success: boolean }> {
    // Atomic insert - if file_path already exists, does nothing and returns empty
    const inserted = await this.db.queryOne<{ workerId: string }>(
      `INSERT INTO file_locks (worker_id, file_path)
       VALUES ($1, $2)
       ON CONFLICT (file_path) DO NOTHING
       RETURNING worker_id`,
      [workerId, filePath]
    );

    if (inserted) {
      // We acquired the lock
      return { success: true };
    }

    // Lock already exists - check if it's ours (idempotent re-acquire)
    const existing = await this.db.queryOne<{ workerId: string }>(
      "SELECT worker_id FROM file_locks WHERE file_path = $1",
      [filePath]
    );

    // Success if we already own this lock
    return { success: existing?.workerId === workerId };
  }

  /**
   * Release specific file locks owned by a worker.
   *
   * Only releases locks that are owned by the specified worker.
   * Silently ignores files that aren't locked by this worker.
   *
   * @param workerId - The worker releasing locks
   * @param files - Array of file paths to unlock
   */
  async releaseLocks(workerId: string, files: string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    // Generate placeholders for the IN clause
    const placeholders = files.map((_, i) => `$${i + 2}`).join(", ");

    await this.db.execute(
      `DELETE FROM file_locks WHERE worker_id = $1 AND file_path IN (${placeholders})`,
      [workerId, ...files]
    );
  }

  /**
   * Release all file locks owned by a worker.
   *
   * Typically called when a worker completes, fails, or is killed.
   *
   * @param workerId - The worker whose locks should be released
   */
  async releaseAllLocks(workerId: string): Promise<void> {
    await this.db.execute("DELETE FROM file_locks WHERE worker_id = $1", [
      workerId,
    ]);
  }

  /**
   * Get all locks held by a specific worker.
   *
   * @param workerId - The worker to query
   * @returns Array of file locks
   */
  async getLocksForWorker(workerId: string): Promise<FileLock[]> {
    return this.db.query<FileLock>(
      "SELECT id, worker_id, file_path, acquired_at FROM file_locks WHERE worker_id = $1",
      [workerId]
    );
  }

  /**
   * Get the worker holding a lock on a specific file.
   *
   * @param filePath - The file to check
   * @returns The lock info if locked, null otherwise
   */
  async getLockHolder(filePath: string): Promise<FileLock | null> {
    return this.db.queryOne<FileLock>(
      "SELECT id, worker_id, file_path, acquired_at FROM file_locks WHERE file_path = $1",
      [filePath]
    );
  }
}
