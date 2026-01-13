import { describe, test, expect, beforeEach } from 'bun:test';
import { ReviewStepRegistry } from '../plugin/registry.js';
import type { ReviewStep, ReviewStepMetadata, ReviewStepConfig } from '../types/review-step.js';
import type { ReviewContext } from '../types/review-context.js';
import type { ReviewStepResult } from '../types/review-result.js';
import { ReviewStatus } from '../types/review-result.js';

// Mock review step implementation for testing
class MockReviewStep implements ReviewStep {
  readonly type = 'mock';
  readonly name = 'Mock Review Step';
  readonly description = 'A mock review step for testing';
  private config?: ReviewStepConfig;

  async initialize(config: ReviewStepConfig): Promise<void> {
    this.config = config;
  }

  async execute(context: ReviewContext): Promise<ReviewStepResult> {
    return {
      stepName: this.config?.name || 'mock',
      status: ReviewStatus.PASS,
      messages: [],
      durationMs: 100,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async cleanup(): Promise<void> {
    // No cleanup needed
  }

  validateConfig(config: ReviewStepConfig): string[] {
    const errors: string[] = [];
    if (!config.name) {
      errors.push('name is required');
    }
    return errors;
  }
}

describe('ReviewStepRegistry', () => {
  let registry: ReviewStepRegistry;
  let mockMetadata: ReviewStepMetadata;

  beforeEach(() => {
    registry = new ReviewStepRegistry();
    mockMetadata = {
      type: 'mock',
      name: 'Mock Step',
      description: 'A mock step',
      factory: async (config) => new MockReviewStep(),
      defaults: {
        id: '',
        name: '',
        blocking: true,
        enabled: true,
        timeoutMs: 30000,
        options: {},
      },
    };
  });

  describe('register', () => {
    test('should register a new review step', () => {
      registry.register(mockMetadata);
      expect(registry.has('mock')).toBe(true);
    });

    test('should throw error when registering duplicate type', () => {
      registry.register(mockMetadata);
      expect(() => registry.register(mockMetadata)).toThrow(
        "Review step type 'mock' is already registered"
      );
    });

    test('should store metadata correctly', () => {
      registry.register(mockMetadata);
      const retrieved = registry.getMetadata('mock');
      expect(retrieved).toEqual(mockMetadata);
    });
  });

  describe('unregister', () => {
    test('should unregister an existing step', () => {
      registry.register(mockMetadata);
      const result = registry.unregister('mock');
      expect(result).toBe(true);
      expect(registry.has('mock')).toBe(false);
    });

    test('should return false when unregistering non-existent step', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('has', () => {
    test('should return true for registered step', () => {
      registry.register(mockMetadata);
      expect(registry.has('mock')).toBe(true);
    });

    test('should return false for unregistered step', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getMetadata', () => {
    test('should return metadata for registered step', () => {
      registry.register(mockMetadata);
      const metadata = registry.getMetadata('mock');
      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe('mock');
    });

    test('should return undefined for unregistered step', () => {
      const metadata = registry.getMetadata('nonexistent');
      expect(metadata).toBeUndefined();
    });
  });

  describe('getTypes', () => {
    test('should return empty array when no steps registered', () => {
      expect(registry.getTypes()).toEqual([]);
    });

    test('should return all registered types', () => {
      registry.register(mockMetadata);
      registry.register({
        ...mockMetadata,
        type: 'another-mock',
      });
      const types = registry.getTypes();
      expect(types).toHaveLength(2);
      expect(types).toContain('mock');
      expect(types).toContain('another-mock');
    });
  });

  describe('getAllMetadata', () => {
    test('should return empty array when no steps registered', () => {
      expect(registry.getAllMetadata()).toEqual([]);
    });

    test('should return all metadata objects', () => {
      const metadata2 = {
        ...mockMetadata,
        type: 'another-mock',
      };
      registry.register(mockMetadata);
      registry.register(metadata2);
      const allMetadata = registry.getAllMetadata();
      expect(allMetadata).toHaveLength(2);
      expect(allMetadata).toContainEqual(mockMetadata);
      expect(allMetadata).toContainEqual(metadata2);
    });
  });

  describe('create', () => {
    test('should create and initialize a step instance', async () => {
      registry.register(mockMetadata);
      const config: ReviewStepConfig = {
        id: 'test-step',
        name: 'Test Step',
        blocking: true,
        enabled: true,
        timeoutMs: 30000,
        options: {},
      };
      const step = await registry.create('mock', config);
      expect(step).toBeInstanceOf(MockReviewStep);
      expect(step.type).toBe('mock');
    });

    test('should merge defaults with provided config', async () => {
      registry.register({
        ...mockMetadata,
        defaults: {
          id: 'default-id',
          name: 'Default Name',
          blocking: true,
          enabled: true,
          timeoutMs: 60000,
          options: { defaultOption: 'value' },
        },
      });
      const config: ReviewStepConfig = {
        id: 'test-step',
        name: 'Test Step',
        blocking: false,
        enabled: true,
        timeoutMs: 30000,
        options: { customOption: 'custom' },
      };
      const step = await registry.create('mock', config);
      expect(step).toBeDefined();
    });

    test('should throw error for unregistered step type', async () => {
      const config: ReviewStepConfig = {
        id: 'test-step',
        name: 'Test Step',
        blocking: true,
        enabled: true,
        timeoutMs: 30000,
        options: {},
      };
      await expect(registry.create('nonexistent', config)).rejects.toThrow(
        "Review step type 'nonexistent' is not registered"
      );
    });

    test('should throw error for invalid configuration', async () => {
      registry.register(mockMetadata);
      const invalidConfig: ReviewStepConfig = {
        id: 'test-step',
        name: '', // Invalid: empty name
        blocking: true,
        enabled: true,
        timeoutMs: 30000,
        options: {},
      };
      await expect(registry.create('mock', invalidConfig)).rejects.toThrow(
        'Invalid configuration'
      );
    });
  });

  describe('clear', () => {
    test('should remove all registered steps', () => {
      registry.register(mockMetadata);
      registry.register({
        ...mockMetadata,
        type: 'another-mock',
      });
      expect(registry.getTypes()).toHaveLength(2);
      registry.clear();
      expect(registry.getTypes()).toHaveLength(0);
    });
  });
});
