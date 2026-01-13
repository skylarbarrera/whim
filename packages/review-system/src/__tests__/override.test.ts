import { describe, it, expect, beforeEach } from 'bun:test';
import { OverrideManager } from '../blocking/override';

describe('OverrideManager', () => {
  let manager: OverrideManager;

  beforeEach(() => {
    manager = new OverrideManager({
      authorizedUsers: ['admin-user'],
      authorizedTeams: ['org/admin-team'],
      authorizedRoles: ['admin', 'maintain'],
      defaultDurationMs: 60 * 60 * 1000, // 1 hour
      maxDurationMs: 24 * 60 * 60 * 1000, // 24 hours
    });
  });

  describe('checkAuthorization', () => {
    it('should authorize user in authorized list', async () => {
      const result = await manager.checkAuthorization('admin-user');
      expect(result.authorized).toBe(true);
    });

    it('should authorize user in authorized team', async () => {
      const result = await manager.checkAuthorization('team-member', ['org/admin-team']);
      expect(result.authorized).toBe(true);
    });

    it('should authorize user with authorized role', async () => {
      const result = await manager.checkAuthorization('maintainer', [], 'maintain');
      expect(result.authorized).toBe(true);
    });

    it('should deny unauthorized user', async () => {
      const result = await manager.checkAuthorization('regular-user');
      expect(result.authorized).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('createOverride', () => {
    it('should create override with default duration', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      expect(override.id).toBeDefined();
      expect(override.owner).toBe('test-owner');
      expect(override.repo).toBe('test-repo');
      expect(override.prNumber).toBe(123);
      expect(override.requestedBy).toBe('admin-user');
      expect(override.reason).toBe('Emergency fix');
      expect(override.token).toBeDefined();
      expect(override.token).toMatch(/^override_/);
      expect(override.active).toBe(true);
      expect(override.revoked).toBe(false);
    });

    it('should create override with custom duration', async () => {
      const customDuration = 30 * 60 * 1000; // 30 minutes
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix',
        customDuration
      );

      const expectedExpiry = new Date(override.requestedAt.getTime() + customDuration);
      expect(override.expiresAt.getTime()).toBeCloseTo(expectedExpiry.getTime(), -2);
    });

    it('should cap duration at maxDurationMs', async () => {
      const excessiveDuration = 48 * 60 * 60 * 1000; // 48 hours (exceeds 24h max)
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix',
        excessiveDuration
      );

      const maxDuration = 24 * 60 * 60 * 1000;
      const expectedExpiry = new Date(override.requestedAt.getTime() + maxDuration);
      expect(override.expiresAt.getTime()).toBeCloseTo(expectedExpiry.getTime(), -2);
    });

    it('should log override creation', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      const logs = manager.getAuditLogs(override.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('created');
      expect(logs[0].user).toBe('admin-user');
    });
  });

  describe('validateOverride', () => {
    it('should validate active override', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      const validation = await manager.validateOverride(override.token);
      expect(validation.valid).toBe(true);
      expect(validation.override).toBeDefined();
    });

    it('should reject invalid token', async () => {
      const validation = await manager.validateOverride('invalid-token');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('Override not found');
    });

    it('should reject revoked override', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      await manager.revokeOverride(override.id, 'admin-user');

      const validation = await manager.validateOverride(override.token);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('Override has been revoked');
    });

    it('should reject expired override', async () => {
      const shortDuration = 100; // 100ms
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix',
        shortDuration
      );

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200));

      const validation = await manager.validateOverride(override.token);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('Override has expired');
    });
  });

  describe('useOverride', () => {
    it('should log override usage', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      await manager.useOverride(override.token, 'deployer-user');

      const logs = manager.getAuditLogs(override.id);
      const usageLog = logs.find((log) => log.action === 'used');
      expect(usageLog).toBeDefined();
      expect(usageLog?.user).toBe('deployer-user');
    });

    it('should throw on invalid token', async () => {
      await expect(manager.useOverride('invalid-token', 'deployer-user')).rejects.toThrow('Invalid override');
    });
  });

  describe('revokeOverride', () => {
    it('should revoke active override', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      await manager.revokeOverride(override.id, 'admin-user');

      const retrieved = manager.getOverride(override.id);
      expect(retrieved?.revoked).toBe(true);
      expect(retrieved?.active).toBe(false);
      expect(retrieved?.revokedBy).toBe('admin-user');
      expect(retrieved?.revokedAt).toBeDefined();
    });

    it('should log override revocation', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      await manager.revokeOverride(override.id, 'admin-user');

      const logs = manager.getAuditLogs(override.id);
      const revocationLog = logs.find((log) => log.action === 'revoked');
      expect(revocationLog).toBeDefined();
      expect(revocationLog?.user).toBe('admin-user');
    });

    it('should throw if override not found', async () => {
      await expect(manager.revokeOverride('invalid-id', 'admin-user')).rejects.toThrow('Override not found');
    });

    it('should throw if already revoked', async () => {
      const override = await manager.createOverride(
        'test-owner',
        'test-repo',
        123,
        'admin-user',
        'Emergency fix'
      );

      await manager.revokeOverride(override.id, 'admin-user');

      await expect(manager.revokeOverride(override.id, 'admin-user')).rejects.toThrow('Override already revoked');
    });
  });

  describe('getActiveOverrides', () => {
    it('should return active overrides for a PR', async () => {
      await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason 1');
      await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason 2');
      await manager.createOverride('test-owner', 'test-repo', 456, 'admin-user', 'Reason 3');

      const active = manager.getActiveOverrides('test-owner', 'test-repo', 123);
      expect(active).toHaveLength(2);
    });

    it('should not return revoked overrides', async () => {
      const override = await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason');
      await manager.revokeOverride(override.id, 'admin-user');

      const active = manager.getActiveOverrides('test-owner', 'test-repo', 123);
      expect(active).toHaveLength(0);
    });

    it('should not return expired overrides', async () => {
      await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason', 100);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200));

      const active = manager.getActiveOverrides('test-owner', 'test-repo', 123);
      expect(active).toHaveLength(0);
    });
  });

  describe('getOverride', () => {
    it('should return override by ID', async () => {
      const override = await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason');

      const retrieved = manager.getOverride(override.id);
      expect(retrieved).toEqual(override);
    });

    it('should return undefined for non-existent ID', () => {
      const retrieved = manager.getOverride('invalid-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAuditLogs', () => {
    it('should return audit logs for an override', async () => {
      const override = await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason');
      await manager.useOverride(override.token, 'deployer-user');
      await manager.revokeOverride(override.id, 'admin-user');

      const logs = manager.getAuditLogs(override.id);
      expect(logs).toHaveLength(3);
      expect(logs[0].action).toBe('created');
      expect(logs[1].action).toBe('used');
      expect(logs[2].action).toBe('revoked');
    });
  });

  describe('getAllAuditLogs', () => {
    it('should return all audit logs', async () => {
      const override1 = await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason 1');
      const override2 = await manager.createOverride('test-owner', 'test-repo', 456, 'admin-user', 'Reason 2');

      const logs = manager.getAllAuditLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('cleanupExpiredOverrides', () => {
    it('should mark expired overrides as inactive', async () => {
      const override = await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason', 100);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200));

      const count = await manager.cleanupExpiredOverrides();
      expect(count).toBe(1);

      const retrieved = manager.getOverride(override.id);
      expect(retrieved?.active).toBe(false);
    });

    it('should log expiration', async () => {
      const override = await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason', 100);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200));

      await manager.cleanupExpiredOverrides();

      const logs = manager.getAuditLogs(override.id);
      const expirationLog = logs.find((log) => log.action === 'expired');
      expect(expirationLog).toBeDefined();
      expect(expirationLog?.user).toBe('system');
    });

    it('should return count of expired overrides', async () => {
      await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason 1', 100);
      await manager.createOverride('test-owner', 'test-repo', 456, 'admin-user', 'Reason 2', 100);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200));

      const count = await manager.cleanupExpiredOverrides();
      expect(count).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all overrides and audit logs', async () => {
      await manager.createOverride('test-owner', 'test-repo', 123, 'admin-user', 'Reason');

      manager.clear();

      const logs = manager.getAllAuditLogs();
      expect(logs).toHaveLength(0);
    });
  });
});
