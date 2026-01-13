import type { SimpleWorkflowConfig, WorkflowTriggers } from '../types/config.js';
import type { SimpleStepConfig } from '../types/config.js';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Configuration validator for review workflows
 * Validates schema compliance, required fields, and business rules
 */
export class ConfigValidator {
  /**
   * Validate a complete workflow configuration
   */
  validateWorkflow(config: SimpleWorkflowConfig): ValidationResult {
    const errors: ValidationError[] = [];

    // Required fields
    if (!config.name) {
      errors.push({ field: 'name', message: 'Workflow name is required' });
    }

    if (!config.steps || !Array.isArray(config.steps)) {
      errors.push({ field: 'steps', message: 'Steps array is required' });
    } else {
      // Validate each step
      config.steps.forEach((step: SimpleStepConfig, index: number) => {
        const stepErrors = this.validateStep(step);
        stepErrors.errors.forEach((err) => {
          errors.push({
            field: `steps[${index}].${err.field}`,
            message: err.message,
          });
        });
      });
    }

    // Validate triggers if present
    if (config.triggers) {
      const triggerErrors = this.validateTriggers(config.triggers);
      triggerErrors.errors.forEach((err) => {
        errors.push({
          field: `triggers.${err.field}`,
          message: err.message,
        });
      });
    }

    // Validate stepGroups if present
    if (config.stepGroups) {
      const groupErrors = this.validateStepGroups(config);
      errors.push(...groupErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a single step configuration
   */
  validateStep(step: SimpleStepConfig): ValidationResult {
    const errors: ValidationError[] = [];

    // Required fields
    if (!step.name) {
      errors.push({ field: 'name', message: 'Step name is required' });
    }

    if (!step.type) {
      errors.push({ field: 'type', message: 'Step type is required' });
    }

    // Validate timeout
    if (step.timeout !== undefined) {
      if (typeof step.timeout !== 'number' || step.timeout <= 0) {
        errors.push({ field: 'timeout', message: 'Timeout must be a positive number' });
      }
    }

    // Validate blocking
    if (step.blocking !== undefined && typeof step.blocking !== 'boolean') {
      errors.push({ field: 'blocking', message: 'Blocking must be a boolean' });
    }

    // Validate condition
    if (step.condition !== undefined && typeof step.condition !== 'string') {
      errors.push({ field: 'condition', message: 'Condition must be a string' });
    }

    // Validate config is an object
    if (step.config !== undefined && typeof step.config !== 'object') {
      errors.push({ field: 'config', message: 'Config must be an object' });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate workflow triggers
   */
  validateTriggers(triggers: WorkflowTriggers): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate repositories
    if (triggers.repositories !== undefined) {
      if (!Array.isArray(triggers.repositories)) {
        errors.push({ field: 'repositories', message: 'Repositories must be an array' });
      } else {
        triggers.repositories.forEach((repo: string, index: number) => {
          if (typeof repo !== 'string') {
            errors.push({
              field: `repositories[${index}]`,
              message: 'Repository must be a string',
            });
          }
        });
      }
    }

    // Validate labels
    if (triggers.requiredLabels !== undefined) {
      if (!Array.isArray(triggers.requiredLabels)) {
        errors.push({ field: 'requiredLabels', message: 'Required labels must be an array' });
      }
    }

    if (triggers.excludedLabels !== undefined) {
      if (!Array.isArray(triggers.excludedLabels)) {
        errors.push({ field: 'excludedLabels', message: 'Excluded labels must be an array' });
      }
    }

    // Validate target branches
    if (triggers.targetBranches !== undefined) {
      if (!Array.isArray(triggers.targetBranches)) {
        errors.push({ field: 'targetBranches', message: 'Target branches must be an array' });
      }
    }

    // Validate aiGeneratedOnly
    if (triggers.aiGeneratedOnly !== undefined && typeof triggers.aiGeneratedOnly !== 'boolean') {
      errors.push({ field: 'aiGeneratedOnly', message: 'AI generated only must be a boolean' });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate step groups and dependencies
   */
  validateStepGroups(config: SimpleWorkflowConfig): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!config.stepGroups) return errors;

    const stepNames = new Set(config.steps.map((s: SimpleStepConfig) => s.name));

    Object.entries(config.stepGroups).forEach(([groupName, steps]) => {
      if (!Array.isArray(steps)) {
        errors.push({
          field: `stepGroups.${groupName}`,
          message: 'Step group must be an array of step names',
        });
        return;
      }

      steps.forEach((stepName: string, index: number) => {
        if (!stepNames.has(stepName)) {
          errors.push({
            field: `stepGroups.${groupName}[${index}]`,
            message: `Step "${stepName}" does not exist in workflow`,
          });
        }
      });
    });

    return errors;
  }

  /**
   * Validate that required steps exist
   */
  validateRequiredSteps(config: SimpleWorkflowConfig, requiredSteps: string[]): ValidationResult {
    const errors: ValidationError[] = [];
    const stepNames = new Set(config.steps.map((s: SimpleStepConfig) => s.name));

    requiredSteps.forEach((required) => {
      if (!stepNames.has(required)) {
        errors.push({
          field: 'steps',
          message: `Required step "${required}" not found in workflow`,
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate custom rules
   */
  validateCustomRules(
    config: SimpleWorkflowConfig,
    rules: Array<(config: SimpleWorkflowConfig) => ValidationError | null>
  ): ValidationResult {
    const errors: ValidationError[] = [];

    rules.forEach((rule) => {
      const error = rule(config);
      if (error) {
        errors.push(error);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
