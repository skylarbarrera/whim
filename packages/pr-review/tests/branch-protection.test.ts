import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { BranchProtectionManager, type BranchProtection } from '../src/branch-protection';
import { REVIEW_STATUS_CONTEXT } from '../src/github-status';

// Mock Octokit
const mockGetBranchProtection = mock(() => Promise.resolve({
  data: {
    required_status_checks: {
      contexts: ['ci/test', REVIEW_STATUS_CONTEXT],
    },
    required_linear_history: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  },
}));

const mockUpdateBranchProtection = mock(() => Promise.resolve({ data: {} }));

mock.module('@octokit/rest', () => ({
  Octokit: class {
    repos = {
      getBranchProtection: mockGetBranchProtection,
      updateBranchProtection: mockUpdateBranchProtection,
    };
  },
}));

describe('BranchProtectionManager', () => {
  let manager: BranchProtectionManager;

  beforeEach(() => {
    manager = new BranchProtectionManager('fake-token');
    mockGetBranchProtection.mockClear();
    mockUpdateBranchProtection.mockClear();
  });

  describe('getProtection', () => {
    it('should get branch protection settings', async () => {
      const protection = await manager.getProtection('test-owner', 'test-repo', 'main');

      expect(mockGetBranchProtection).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
      });

      expect(protection).not.toBeNull();
      expect(protection?.enabled).toBe(true);
      expect(protection?.requiredStatusChecks).toContain(REVIEW_STATUS_CONTEXT);
    });

    it('should return null for branches without protection', async () => {
      mockGetBranchProtection.mockRejectedValueOnce({ status: 404 });

      const protection = await manager.getProtection('test-owner', 'test-repo', 'feature');

      expect(protection).toBeNull();
    });

    it('should throw on other errors', async () => {
      mockGetBranchProtection.mockRejectedValueOnce({ status: 500, message: 'Server error' });

      await expect(
        manager.getProtection('test-owner', 'test-repo', 'main')
      ).rejects.toThrow();
    });
  });

  describe('addRequiredStatusCheck', () => {
    it('should add review status to existing protection', async () => {
      mockGetBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            contexts: ['ci/test'],
          },
          required_linear_history: { enabled: false },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.addRequiredStatusCheck('test-owner', 'test-repo', 'main');

      expect(mockUpdateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: false,
            contexts: ['ci/test', REVIEW_STATUS_CONTEXT],
          },
        })
      );
    });

    it('should not add duplicate status check', async () => {
      mockGetBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            contexts: [REVIEW_STATUS_CONTEXT],
          },
          required_linear_history: { enabled: false },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.addRequiredStatusCheck('test-owner', 'test-repo', 'main');

      // Should not update if already present
      expect(mockUpdateBranchProtection).not.toHaveBeenCalled();
    });

    it('should create minimal protection if none exists', async () => {
      mockGetBranchProtection.mockRejectedValueOnce({ status: 404 });

      await manager.addRequiredStatusCheck('test-owner', 'test-repo', 'main');

      expect(mockUpdateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: false,
            contexts: [REVIEW_STATUS_CONTEXT],
          },
        })
      );
    });
  });

  describe('removeRequiredStatusCheck', () => {
    it('should remove review status from protection', async () => {
      mockGetBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            contexts: ['ci/test', REVIEW_STATUS_CONTEXT],
          },
          required_linear_history: { enabled: false },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.removeRequiredStatusCheck('test-owner', 'test-repo', 'main');

      expect(mockUpdateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: {
            strict: false,
            contexts: ['ci/test'],
          },
        })
      );
    });

    it('should remove status check requirement if last check', async () => {
      mockGetBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            contexts: [REVIEW_STATUS_CONTEXT],
          },
          required_linear_history: { enabled: false },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      await manager.removeRequiredStatusCheck('test-owner', 'test-repo', 'main');

      expect(mockUpdateBranchProtection).toHaveBeenCalledWith(
        expect.objectContaining({
          required_status_checks: null,
        })
      );
    });

    it('should return null if no protection exists', async () => {
      mockGetBranchProtection.mockRejectedValueOnce({ status: 404 });

      const result = await manager.removeRequiredStatusCheck('test-owner', 'test-repo', 'main');

      expect(result).toBeNull();
    });
  });

  describe('isReviewRequired', () => {
    it('should return true if review is required', async () => {
      const required = await manager.isReviewRequired('test-owner', 'test-repo', 'main');

      expect(required).toBe(true);
    });

    it('should return false if review is not required', async () => {
      mockGetBranchProtection.mockResolvedValueOnce({
        data: {
          required_status_checks: {
            contexts: ['ci/test'],
          },
          required_linear_history: { enabled: false },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        },
      });

      const required = await manager.isReviewRequired('test-owner', 'test-repo', 'main');

      expect(required).toBe(false);
    });

    it('should return false if no protection exists', async () => {
      mockGetBranchProtection.mockRejectedValueOnce({ status: 404 });

      const required = await manager.isReviewRequired('test-owner', 'test-repo', 'main');

      expect(required).toBe(false);
    });
  });

  describe('syncProtectionAcrossBranches', () => {
    it('should sync protection across multiple branches', async () => {
      mockGetBranchProtection.mockRejectedValue({ status: 404 });

      const results = await manager.syncProtectionAcrossBranches(
        'test-owner',
        'test-repo',
        ['main', 'develop', 'staging']
      );

      expect(results.size).toBe(3);
      expect(results.get('main')).toBe(true);
      expect(results.get('develop')).toBe(true);
      expect(results.get('staging')).toBe(true);
      expect(mockUpdateBranchProtection).toHaveBeenCalledTimes(3);
    });

    it('should handle failures gracefully', async () => {
      mockGetBranchProtection
        .mockRejectedValueOnce({ status: 404 }) // main - success
        .mockRejectedValueOnce({ status: 500 }); // develop - fail

      const results = await manager.syncProtectionAcrossBranches(
        'test-owner',
        'test-repo',
        ['main', 'develop']
      );

      expect(results.get('main')).toBe(true);
      expect(results.get('develop')).toBe(false);
    });
  });
});
