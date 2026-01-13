import type { ReviewStep, ReviewStepMetadata, ReviewStepConfig, ReviewStepFactory } from '../types/review-step.js';

/**
 * Registry for managing review step plugins
 */
export class ReviewStepRegistry {
  private steps = new Map<string, ReviewStepMetadata>();

  /**
   * Register a new review step type
   *
   * @param metadata Metadata and factory for the review step
   * @throws Error if a step with this type is already registered
   */
  register(metadata: ReviewStepMetadata): void {
    if (this.steps.has(metadata.type)) {
      throw new Error(`Review step type '${metadata.type}' is already registered`);
    }

    this.steps.set(metadata.type, metadata);
  }

  /**
   * Unregister a review step type
   *
   * @param type Type identifier of the step to unregister
   * @returns true if the step was unregistered, false if it wasn't registered
   */
  unregister(type: string): boolean {
    return this.steps.delete(type);
  }

  /**
   * Check if a review step type is registered
   *
   * @param type Type identifier to check
   * @returns true if registered, false otherwise
   */
  has(type: string): boolean {
    return this.steps.has(type);
  }

  /**
   * Get metadata for a registered review step type
   *
   * @param type Type identifier
   * @returns Metadata for the step, or undefined if not registered
   */
  getMetadata(type: string): ReviewStepMetadata | undefined {
    return this.steps.get(type);
  }

  /**
   * Get all registered review step types
   *
   * @returns Array of type identifiers
   */
  getTypes(): string[] {
    return Array.from(this.steps.keys());
  }

  /**
   * Get metadata for all registered review steps
   *
   * @returns Array of metadata objects
   */
  getAllMetadata(): ReviewStepMetadata[] {
    return Array.from(this.steps.values());
  }

  /**
   * Create an instance of a review step
   *
   * @param type Type identifier of the step to create
   * @param config Configuration for the step instance
   * @returns Promise resolving to the created step instance
   * @throws Error if the step type is not registered
   */
  async create(type: string, config: ReviewStepConfig): Promise<ReviewStep> {
    const metadata = this.steps.get(type);

    if (!metadata) {
      throw new Error(`Review step type '${type}' is not registered`);
    }

    // Merge defaults with provided config
    const mergedConfig: ReviewStepConfig = {
      ...metadata.defaults,
      ...config,
      options: {
        ...metadata.defaults.options,
        ...config.options,
      },
    };

    const step = await metadata.factory(mergedConfig);

    // Validate the configuration
    const validationErrors = step.validateConfig(mergedConfig);
    if (validationErrors.length > 0) {
      throw new Error(
        `Invalid configuration for step '${type}': ${validationErrors.join(', ')}`
      );
    }

    // Initialize the step
    await step.initialize(mergedConfig);

    return step;
  }

  /**
   * Clear all registered review steps
   * Useful for testing
   */
  clear(): void {
    this.steps.clear();
  }
}

/**
 * Global singleton instance of the registry
 */
export const globalRegistry = new ReviewStepRegistry();
