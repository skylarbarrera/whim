import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { BranchProtectionManager } from '../blocking/branch-protection';

// Mock Octokit
const mockOctokit = {
  repos: {
    updateBranchProtection: mock(() => Promise.resolve({ data: {} })),
    deleteBranchProtection: mock(() => Promise.resolve()),
    getBranchProtection: mock(() => Promise.resolve({ data: {} })),
  },
};

// Mock the Octokit import
mock.module('@octokit/rest', () => ({
  Octokit: mock(() => mockOctokit),
}));

describe('BranchProtectionManager', () => {
  let manager: BranchProtectionManager;

  beforeEach(() => {
    manager = new BranchProtectionManager('test-token');
    mockOctokit.repos.updateBranchProtection.mockClear();
    mockOctokit.repos.deleteBranchProtection.mockClear();
    mockOctokit.repos.getBranchProtection.mockClear();
  });

  describe('enableProtection', () => {
    it('should enable branch protection with required status checks', async () => {
      await manager.enableProtection({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        requiredStatusChecks: {
          strict: true,
          contexts: ['review/lint', 'review/test'],
        },
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'main',
          required_status_checks: {
            strict: true,
            contexts: ['review/lint', 'review/test'],
          },
        })
      );
    });

    it('should enable branch protection with required reviews', async () => {
      await manager.enableProtection({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        requiredPullRequestReviews: {
          dismissStaleReviews: true,
          requireCodeOwnerReviews: true,
          requiredApprovingReviewCount: 2,
        },
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_pull_request_reviews: {
            dismiss_stale_reviews: true,
            require_code_owner_reviews: true,
            required_approving_review_count: 2,
          },
        })
      );
    });

    it('should enable branch protection with enforce admins', async () => {
      await manager.enableProtection({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        enforceAdmins: true,
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          enforce_admins: true,
        })
      );
    });

    it('should enable branch protection with restrictions', async () => {
      await manager.enableProtection({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        restrictions: {
          users: ['admin-user'],
          teams: ['admin-team'],
        },
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          restrictions: {
            users: ['admin-user'],
            teams: ['admin-team'],
          },
        })
      );
    });

    it('should enable branch protection with allow force pushes', async () => {
      await manager.enableProtection({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        allowForcePushes: true,
        allowDeletions: true,
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          allow_force_pushes: true,
          allow_deletions: true,
        })
      );
    });
  });

  describe('updateProtection', () => {
    it('should update existing branch protection', async () => {
      await manager.updateProtection({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        requiredStatusChecks: {
          strict: true,
          contexts: ['review/lint'],
        },
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalled();
    });
  });

  describe('disableProtection', () => {
    it('should delete branch protection', async () => {
      await manager.disableProtection('test-owner', 'test-repo', 'main');

      expect(mockOctokit.repos.deleteBranchProtection).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
      });
    });

    it('should not throw if protection does not exist', async () => {
      mockOctokit.repos.deleteBranchProtection.mockRejectedValueOnce({ status: 404 });

      await expect(manager.disableProtection('test-owner', 'test-repo', 'main')).resolves.not.toThrow();
    });

    it('should throw if deletion fails with non-404 error', async () => {
      mockOctokit.repos.deleteBranchProtection.mockRejectedValueOnce({ status: 500, message: 'Server error' });

      await expect(manager.disableProtection('test-owner', 'test-repo', 'main')).rejects.toThrow();
    });
  });

  describe('getProtectionStatus', () => {
    it('should return enabled status with config', async () => {
      mockOctokit.repos.getBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            strict: true,
            contexts: ['review/lint'],
          },
          required_pull_request_reviews: {
            dismiss_stale_reviews: true,
            require_code_owner_reviews: false,
            required_approving_review_count: 1,
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      const status = await manager.getProtectionStatus('test-owner', 'test-repo', 'main');

      expect(status.enabled).toBe(true);
      expect(status.config).toBeDefined();
      expect(status.config?.requiredStatusChecks).toEqual({
        strict: true,
        contexts: ['review/lint'],
      });
    });

    it('should return disabled status if protection not found', async () => {
      mockOctokit.repos.getBranchProtection.mockRejectedValueOnce({ status: 404 });

      const status = await manager.getProtectionStatus('test-owner', 'test-repo', 'main');

      expect(status.enabled).toBe(false);
      expect(status.config).toBeUndefined();
    });

    it('should return error status on failure', async () => {
      mockOctokit.repos.getBranchProtection.mockRejectedValueOnce({ status: 500, message: 'Server error' });

      const status = await manager.getProtectionStatus('test-owner', 'test-repo', 'main');

      expect(status.enabled).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe('addRequiredStatusChecks', () => {
    it('should add new contexts to existing checks', async () => {
      mockOctokit.repos.getBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            strict: true,
            contexts: ['review/lint'],
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.addRequiredStatusChecks('test-owner', 'test-repo', 'main', ['review/test']);

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: true,
            contexts: expect.arrayContaining(['review/lint', 'review/test']),
          },
        })
      );
    });

    it('should not add duplicate contexts', async () => {
      mockOctokit.repos.getBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            strict: true,
            contexts: ['review/lint'],
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.addRequiredStatusChecks('test-owner', 'test-repo', 'main', ['review/lint']);

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: true,
            contexts: ['review/lint'],
          },
        })
      );
    });

    it('should throw if protection not enabled', async () => {
      mockOctokit.repos.getBranchProtection.mockRejectedValueOnce({ status: 404 });

      await expect(
        manager.addRequiredStatusChecks('test-owner', 'test-repo', 'main', ['review/test'])
      ).rejects.toThrow('Branch protection must be enabled');
    });
  });

  describe('removeRequiredStatusChecks', () => {
    it('should remove contexts from existing checks', async () => {
      mockOctokit.repos.getBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            strict: true,
            contexts: ['review/lint', 'review/test'],
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.removeRequiredStatusChecks('test-owner', 'test-repo', 'main', ['review/test']);

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: true,
            contexts: ['review/lint'],
          },
        })
      );
    });

    it('should not fail if protection not enabled', async () => {
      mockOctokit.repos.getBranchProtection.mockRejectedValueOnce({ status: 404 });

      await expect(
        manager.removeRequiredStatusChecks('test-owner', 'test-repo', 'main', ['review/test'])
      ).resolves.not.toThrow();
    });
  });

  describe('setRequiredStatusChecks', () => {
    it('should replace all contexts', async () => {
      mockOctokit.repos.getBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            strict: true,
            contexts: ['review/lint'],
          },
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.setRequiredStatusChecks('test-owner', 'test-repo', 'main', {
        strict: false,
        contexts: ['review/test', 'review/security'],
      });

      expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: false,
            contexts: ['review/test', 'review/security'],
          },
        })
      );
    });

    it('should throw if protection not enabled', async () => {
      mockOctokit.repos.getBranchProtection.mockRejectedValueOnce({ status: 404 });

      await expect(
        manager.setRequiredStatusChecks('test-owner', 'test-repo', 'main', {
          strict: true,
          contexts: ['review/test'],
        })
      ).rejects.toThrow('Branch protection must be enabled');
    });
  });
});
