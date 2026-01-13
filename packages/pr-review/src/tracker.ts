import type { PRReview, PRReviewCheck, ReviewStatus, CheckStatus, CheckType } from '@factory/shared';

/**
 * Database row types from PostgreSQL (snake_case)
 */
interface PRReviewRow {
  id: string;
  repo_owner: string;
  repo_name: string;
  pr_number: number;
  status: ReviewStatus;
  is_ai_generated: boolean;
  detection_confidence: number;
  detection_reasons: string[];
  started_at: Date;
  completed_at: Date | null;
  merge_blocked: boolean;
  override_user: string | null;
  override_reason: string | null;
  override_at: Date | null;
  created_at: Date;
  updated_at: Date;
  [key: string]: unknown;
}

interface PRReviewCheckRow {
  id: string;
  review_id: string;
  check_name: string;
  check_type: CheckType;
  status: CheckStatus;
  required: boolean;
  summary: string | null;
  details: string | null;
  error_count: number;
  warning_count: number;
  duration: number | null;
  started_at: Date;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  [key: string]: unknown;
}

/**
 * Convert snake_case database row to camelCase
 */
function rowToCamelCase<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

/**
 * Database interface for executing queries
 */
export interface DatabaseClient {
  query<T>(text: string, values?: unknown[]): Promise<T[]>;
  queryOne<T>(text: string, values?: unknown[]): Promise<T | null>;
  execute(text: string, values?: unknown[]): Promise<{ rowCount: number }>;
}

/**
 * Manages PR review lifecycle in the database
 */
export class ReviewTracker {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new PR review
   */
  async createReview(params: {
    repoOwner: string;
    repoName: string;
    prNumber: number;
    headSha: string;
    isAIGenerated: boolean;
    detectionConfidence: number;
    detectionReasons: string[];
  }): Promise<PRReview> {
    const result = await this.db.queryOne<PRReviewRow>(
      `INSERT INTO pr_reviews (
        repo_owner, repo_name, pr_number, head_sha, status,
        is_ai_generated, detection_confidence, detection_reasons,
        started_at, merge_blocked
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      RETURNING *`,
      [
        params.repoOwner,
        params.repoName,
        params.prNumber,
        params.headSha,
        'pending',
        params.isAIGenerated,
        params.detectionConfidence,
        JSON.stringify(params.detectionReasons),
        false,
      ]
    );

    if (!result) {
      throw new Error('Failed to create review');
    }

    return rowToCamelCase<PRReview>(result);
  }

  /**
   * Update review status
   */
  async updateReviewStatus(reviewId: string, status: ReviewStatus): Promise<void> {
    const completedAt = status === 'completed' || status === 'failed' ? 'NOW()' : 'NULL';
    await this.db.execute(
      `UPDATE pr_reviews
       SET status = $1, completed_at = ${completedAt}, updated_at = NOW()
       WHERE id = $2`,
      [status, reviewId]
    );
  }

  /**
   * Update merge blocked status
   */
  async updateMergeBlocked(reviewId: string, blocked: boolean): Promise<void> {
    await this.db.execute(
      `UPDATE pr_reviews
       SET merge_blocked = $1, updated_at = NOW()
       WHERE id = $2`,
      [blocked, reviewId]
    );
  }

  /**
   * Record a check for a review
   */
  async recordCheck(params: {
    reviewId: string;
    checkName: string;
    checkType: CheckType;
    required: boolean;
  }): Promise<PRReviewCheck> {
    const result = await this.db.queryOne<PRReviewCheckRow>(
      `INSERT INTO pr_review_checks (
        review_id, check_name, check_type, status, required,
        error_count, warning_count, started_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      RETURNING *`,
      [
        params.reviewId,
        params.checkName,
        params.checkType,
        'pending',
        params.required,
        0,
        0,
        JSON.stringify({}),
      ]
    );

    if (!result) {
      throw new Error('Failed to record check');
    }

    return rowToCamelCase<PRReviewCheck>(result);
  }

  /**
   * Update a check result
   */
  async updateCheck(checkId: string, params: {
    status: CheckStatus;
    summary?: string;
    details?: string;
    errorCount?: number;
    warningCount?: number;
    duration?: number;
    startedAt?: Date;
    completedAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<PRReviewCheck> {
    const completedAt = params.status === 'success' || params.status === 'failure' || params.status === 'error'
      ? (params.completedAt ? '$8' : 'NOW()')
      : 'NULL';

    const result = await this.db.queryOne<PRReviewCheckRow>(
      `UPDATE pr_review_checks
       SET status = $1,
           summary = COALESCE($2, summary),
           details = COALESCE($3, details),
           error_count = COALESCE($4, error_count),
           warning_count = COALESCE($5, warning_count),
           duration = COALESCE($6, duration),
           metadata = COALESCE($7, metadata),
           completed_at = ${completedAt}
       WHERE id = $9
       RETURNING *`,
      [
        params.status,
        params.summary,
        params.details,
        params.errorCount,
        params.warningCount,
        params.duration,
        params.metadata ? JSON.stringify(params.metadata) : null,
        params.completedAt,
        checkId,
      ]
    );

    if (!result) {
      throw new Error(`Check ${checkId} not found`);
    }

    return rowToCamelCase<PRReviewCheck>(result);
  }

  /**
   * Get a review with all checks
   */
  async getReview(reviewId: string): Promise<{ review: PRReview; checks: PRReviewCheck[] } | null> {
    const reviewRow = await this.db.queryOne<PRReviewRow>(
      'SELECT * FROM pr_reviews WHERE id = $1',
      [reviewId]
    );

    if (!reviewRow) {
      return null;
    }

    const checkRows = await this.db.query<PRReviewCheckRow>(
      'SELECT * FROM pr_review_checks WHERE review_id = $1 ORDER BY created_at',
      [reviewId]
    );

    return {
      review: rowToCamelCase<PRReview>(reviewRow),
      checks: checkRows.map(row => rowToCamelCase<PRReviewCheck>(row)),
    };
  }

  /**
   * Get a review by repository and PR number
   */
  async getReviewByPR(repoOwner: string, repoName: string, prNumber: number): Promise<{ review: PRReview; checks: PRReviewCheck[] } | null> {
    const reviewRow = await this.db.queryOne<PRReviewRow>(
      'SELECT * FROM pr_reviews WHERE repo_owner = $1 AND repo_name = $2 AND pr_number = $3',
      [repoOwner, repoName, prNumber]
    );

    if (!reviewRow) {
      return null;
    }

    const checkRows = await this.db.query<PRReviewCheckRow>(
      'SELECT * FROM pr_review_checks WHERE review_id = $1 ORDER BY created_at',
      [reviewRow.id]
    );

    return {
      review: rowToCamelCase<PRReview>(reviewRow),
      checks: checkRows.map(row => rowToCamelCase<PRReviewCheck>(row)),
    };
  }

  /**
   * Mark a review as overridden
   */
  async markOverridden(reviewId: string, user: string, reason: string): Promise<void> {
    await this.db.execute(
      `UPDATE pr_reviews
       SET override_user = $1, override_reason = $2, override_at = NOW(),
           merge_blocked = false, updated_at = NOW()
       WHERE id = $3`,
      [user, reason, reviewId]
    );
  }

  /**
   * List all reviews with optional filters
   */
  async listReviews(filters?: {
    status?: ReviewStatus;
    repoOwner?: string;
    repoName?: string;
    mergeBlocked?: boolean;
  }): Promise<PRReview[]> {
    let query = 'SELECT * FROM pr_reviews WHERE 1=1';
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters?.repoOwner) {
      query += ` AND repo_owner = $${paramIndex++}`;
      values.push(filters.repoOwner);
    }

    if (filters?.repoName) {
      query += ` AND repo_name = $${paramIndex++}`;
      values.push(filters.repoName);
    }

    if (filters?.mergeBlocked !== undefined) {
      query += ` AND merge_blocked = $${paramIndex++}`;
      values.push(filters.mergeBlocked);
    }

    query += ' ORDER BY created_at DESC';

    const rows = await this.db.query<PRReviewRow>(query, values);
    return rows.map(row => rowToCamelCase<PRReview>(row));
  }
}
