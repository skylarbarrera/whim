import { randomBytes } from 'crypto';

/**
 * Override request for emergency deployments
 */
export interface OverrideRequest {
  /** Unique identifier for this override */
  id: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Pull request number */
  prNumber: number;
  /** User requesting the override */
  requestedBy: string;
  /** Reason for the override */
  reason: string;
  /** When the override was requested */
  requestedAt: Date;
  /** When the override expires */
  expiresAt: Date;
  /** Override token for authorization */
  token: string;
  /** Whether the override is still active */
  active: boolean;
  /** Whether the override was revoked */
  revoked: boolean;
  /** Who revoked the override (if revoked) */
  revokedBy?: string;
  /** When the override was revoked (if revoked) */
  revokedAt?: Date;
}

/**
 * Authorization configuration for overrides
 */
export interface OverrideAuthConfig {
  /** GitHub users authorized to request overrides */
  authorizedUsers?: string[];
  /** GitHub teams authorized to request overrides (org/team format) */
  authorizedTeams?: string[];
  /** GitHub repository roles authorized to request overrides */
  authorizedRoles?: ('admin' | 'maintain')[];
  /** Default override duration in milliseconds */
  defaultDurationMs?: number;
  /** Maximum override duration in milliseconds */
  maxDurationMs?: number;
}

/**
 * Audit log entry for override actions
 */
export interface OverrideAuditLog {
  /** Unique identifier for this log entry */
  id: string;
  /** Override ID this log entry is for */
  overrideId: string;
  /** Action that was performed */
  action: 'created' | 'used' | 'revoked' | 'expired';
  /** User who performed the action */
  user: string;
  /** When the action occurred */
  timestamp: Date;
  /** Additional context about the action */
  context?: Record<string, unknown>;
}

/**
 * Result of override authorization check
 */
export interface OverrideAuthResult {
  /** Whether the user is authorized */
  authorized: boolean;
  /** Reason for denial (if not authorized) */
  reason?: string;
}

/**
 * Manages emergency override mechanism for PR merge blocking
 */
export class OverrideManager {
  private overrides: Map<string, OverrideRequest> = new Map();
  private auditLogs: OverrideAuditLog[] = [];
  private authConfig: OverrideAuthConfig;

  constructor(authConfig: OverrideAuthConfig = {}) {
    this.authConfig = {
      authorizedUsers: authConfig.authorizedUsers || [],
      authorizedTeams: authConfig.authorizedTeams || [],
      authorizedRoles: authConfig.authorizedRoles || ['admin', 'maintain'],
      defaultDurationMs: authConfig.defaultDurationMs || 60 * 60 * 1000, // 1 hour
      maxDurationMs: authConfig.maxDurationMs || 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  /**
   * Check if a user is authorized to request overrides
   */
  async checkAuthorization(user: string, userTeams?: string[], userRole?: string): Promise<OverrideAuthResult> {
    // Check user authorization
    if (this.authConfig.authorizedUsers?.includes(user)) {
      return { authorized: true };
    }

    // Check team authorization
    if (userTeams && this.authConfig.authorizedTeams) {
      for (const team of userTeams) {
        if (this.authConfig.authorizedTeams.includes(team)) {
          return { authorized: true };
        }
      }
    }

    // Check role authorization
    if (userRole && this.authConfig.authorizedRoles?.includes(userRole as any)) {
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: 'User is not authorized to request overrides',
    };
  }

  /**
   * Create a new override request
   */
  async createOverride(
    owner: string,
    repo: string,
    prNumber: number,
    requestedBy: string,
    reason: string,
    durationMs?: number
  ): Promise<OverrideRequest> {
    // Validate duration
    const duration = Math.min(
      durationMs || this.authConfig.defaultDurationMs!,
      this.authConfig.maxDurationMs!
    );

    // Generate secure token
    const token = this.generateToken();
    const id = this.generateId();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration);

    const override: OverrideRequest = {
      id,
      owner,
      repo,
      prNumber,
      requestedBy,
      reason,
      requestedAt: now,
      expiresAt,
      token,
      active: true,
      revoked: false,
    };

    this.overrides.set(id, override);

    // Log the creation
    this.addAuditLog({
      id: this.generateId(),
      overrideId: id,
      action: 'created',
      user: requestedBy,
      timestamp: now,
      context: {
        owner,
        repo,
        prNumber,
        reason,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return override;
  }

  /**
   * Validate an override token
   */
  async validateOverride(token: string): Promise<{ valid: boolean; override?: OverrideRequest; reason?: string }> {
    // Find override by token
    const override = Array.from(this.overrides.values()).find((o) => o.token === token);

    if (!override) {
      return { valid: false, reason: 'Override not found' };
    }

    // Check if revoked
    if (override.revoked) {
      return { valid: false, reason: 'Override has been revoked', override };
    }

    // Check if expired
    if (new Date() > override.expiresAt) {
      override.active = false;
      return { valid: false, reason: 'Override has expired', override };
    }

    // Check if active
    if (!override.active) {
      return { valid: false, reason: 'Override is not active', override };
    }

    return { valid: true, override };
  }

  /**
   * Use an override (marks it as used in audit log)
   */
  async useOverride(token: string, user: string): Promise<void> {
    const validation = await this.validateOverride(token);

    if (!validation.valid || !validation.override) {
      throw new Error(validation.reason || 'Invalid override');
    }

    // Log the usage
    this.addAuditLog({
      id: this.generateId(),
      overrideId: validation.override.id,
      action: 'used',
      user,
      timestamp: new Date(),
      context: {
        owner: validation.override.owner,
        repo: validation.override.repo,
        prNumber: validation.override.prNumber,
      },
    });
  }

  /**
   * Revoke an override
   */
  async revokeOverride(overrideId: string, revokedBy: string): Promise<void> {
    const override = this.overrides.get(overrideId);

    if (!override) {
      throw new Error('Override not found');
    }

    if (override.revoked) {
      throw new Error('Override already revoked');
    }

    override.revoked = true;
    override.active = false;
    override.revokedBy = revokedBy;
    override.revokedAt = new Date();

    // Log the revocation
    this.addAuditLog({
      id: this.generateId(),
      overrideId,
      action: 'revoked',
      user: revokedBy,
      timestamp: new Date(),
      context: {
        owner: override.owner,
        repo: override.repo,
        prNumber: override.prNumber,
      },
    });
  }

  /**
   * Get all active overrides for a PR
   */
  getActiveOverrides(owner: string, repo: string, prNumber: number): OverrideRequest[] {
    return Array.from(this.overrides.values()).filter(
      (override) =>
        override.owner === owner &&
        override.repo === repo &&
        override.prNumber === prNumber &&
        override.active &&
        !override.revoked &&
        new Date() <= override.expiresAt
    );
  }

  /**
   * Get override by ID
   */
  getOverride(overrideId: string): OverrideRequest | undefined {
    return this.overrides.get(overrideId);
  }

  /**
   * Get audit logs for an override
   */
  getAuditLogs(overrideId: string): OverrideAuditLog[] {
    return this.auditLogs.filter((log) => log.overrideId === overrideId);
  }

  /**
   * Get all audit logs
   */
  getAllAuditLogs(): OverrideAuditLog[] {
    return [...this.auditLogs];
  }

  /**
   * Clean up expired overrides
   */
  async cleanupExpiredOverrides(): Promise<number> {
    const now = new Date();
    let count = 0;

    for (const [id, override] of this.overrides.entries()) {
      if (override.active && now > override.expiresAt) {
        override.active = false;

        // Log the expiration
        this.addAuditLog({
          id: this.generateId(),
          overrideId: id,
          action: 'expired',
          user: 'system',
          timestamp: now,
          context: {
            owner: override.owner,
            repo: override.repo,
            prNumber: override.prNumber,
          },
        });

        count++;
      }
    }

    return count;
  }

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    return `override_${randomBytes(32).toString('hex')}`;
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  /**
   * Add an audit log entry
   */
  private addAuditLog(log: OverrideAuditLog): void {
    this.auditLogs.push(log);
  }

  /**
   * Clear all overrides and audit logs (for testing)
   */
  clear(): void {
    this.overrides.clear();
    this.auditLogs = [];
  }
}
