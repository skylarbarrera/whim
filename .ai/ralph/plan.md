# Ralph Iteration Plan

## Goal
Implement configuration management for the review system with YAML-based workflow definitions, repository-specific and organization-level configs, and environment-specific review requirements.

## Files to Create/Modify

**New Files:**
1. `packages/review-system/src/config/loader.ts` - Configuration loader for YAML files
2. `packages/review-system/src/config/validator.ts` - Configuration validator
3. `packages/review-system/src/config/defaults.ts` - Default configuration templates
4. `packages/review-system/src/config/merger.ts` - Configuration merger (org → repo → env)
5. `packages/review-system/src/config/index.ts` - Config module exports
6. `packages/review-system/src/__tests__/config-loader.test.ts` - Loader tests
7. `packages/review-system/src/__tests__/config-validator.test.ts` - Validator tests
8. `packages/review-system/src/__tests__/config-merger.test.ts` - Merger tests

**Example Config Files (for documentation):**
9. `packages/review-system/examples/.review.yml` - Default workflow example
10. `packages/review-system/examples/.review-org.yml` - Organization-level config
11. `packages/review-system/examples/.review-dev.yml` - Development environment config
12. `packages/review-system/examples/.review-prod.yml` - Production environment config

**Modified Files:**
13. `packages/review-system/src/orchestrator/orchestrator.ts` - Use config loader
14. `packages/review-system/src/index.ts` - Export config module
15. `packages/review-system/package.json` - Add js-yaml dependency

## Implementation Plan

### 1. Configuration Loader (loader.ts)
- ConfigLoader class
- loadFromFile(): Load YAML from file path
- loadFromString(): Parse YAML string
- loadFromUrl(): Fetch and parse remote config
- loadOrgConfig(): Load organization-level config
- loadRepoConfig(): Load repository-specific config
- loadEnvConfig(): Load environment-specific config
- Support for multiple config sources:
  - Local file: ./.review.yml
  - Repository: .github/.review.yml
  - Organization: https://org.com/.github/.review.yml
  - Environment: .review-{env}.yml

### 2. Configuration Validator (validator.ts)
- ConfigValidator class
- validateWorkflow(): Validate ReviewWorkflowConfig structure
- validateSteps(): Validate step configurations
- validateTriggers(): Validate workflow triggers
- validateStepGroups(): Validate step groups
- Schema validation using JSON Schema or Zod
- Required field checks
- Type validation (enums, ranges)
- Dependency validation (required steps, contexts)
- Custom validation rules

### 3. Default Configuration (defaults.ts)
- createDefaultConfig(): Factory for default workflow
- defaultLintStep(): Default lint configuration
- defaultTestStep(): Default test configuration
- defaultSecurityStep(): Default security scan configuration
- Templates for common use cases:
  - Minimal (lint only)
  - Standard (lint + test)
  - Full (lint + test + security + coverage)

### 4. Configuration Merger (merger.ts)
- ConfigMerger class
- merge(): Merge multiple configs with priority
- Priority order: environment > repo > org > defaults
- Deep merge for nested objects
- Array concatenation or replacement (configurable)
- Override resolution rules:
  - Workflow-level overrides
  - Step-level overrides
  - Environment-specific overrides

### 5. Integration with Orchestrator
- Update ReviewOrchestrator.loadConfig()
- Support config file path or URL
- Auto-detect environment from env vars
- Cache loaded configs for performance
- Hot reload on config file changes (optional)

### 6. Example Configurations
Create example YAML files demonstrating:
- Basic workflow (lint + test)
- AI-specific workflow with detection
- Multi-environment setup
- Organization-wide defaults
- Repository overrides
- Custom step configurations

### 7. Testing
- Test YAML parsing and loading
- Test config validation (valid and invalid configs)
- Test config merging with different priorities
- Test environment-specific overrides
- Test error handling (missing files, invalid YAML)
- Integration tests with ReviewOrchestrator

## Configuration Schema Example

```yaml
# .review.yml
version: '1.0'
name: 'default-review'
enabled: true

triggers:
  aiGeneratedOnly: false
  targetBranches: ['main', 'develop']
  requiredLabels: []
  excludedLabels: ['skip-review']

steps:
  - name: 'lint'
    type: 'lint'
    blocking: true
    timeout: 300000
    config:
      linters:
        - type: 'eslint'
          filePatterns: ['**/*.ts', '**/*.tsx']
      failOn: 'error'

  - name: 'test'
    type: 'test'
    blocking: true
    timeout: 600000
    config:
      runner: 'jest'
      coverage: true
      coverageThresholds:
        lines: 80
        functions: 80
```

## Exit Criteria
- ✅ Config loader can load YAML from file/string/URL
- ✅ Config validator ensures schema compliance
- ✅ Config merger handles org/repo/env precedence
- ✅ Default configs available for common use cases
- ✅ Example YAML files demonstrate all features
- ✅ ReviewOrchestrator integrates config loader
- ✅ Comprehensive tests for all config modules
- ✅ Package builds successfully
- ✅ TypeScript type checks pass

## Notes
- Use js-yaml for YAML parsing
- Support both .yml and .yaml extensions
- Environment detection via NODE_ENV or custom var
- Config caching for performance
- Clear error messages for config issues
- Backward compatible with existing code
