import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConfigLoader } from '../config/loader.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

describe('ConfigLoader', () => {
  let loader: ConfigLoader;
  let testDir: string;

  beforeEach(async () => {
    loader = new ConfigLoader();
    testDir = join(process.cwd(), 'test-config-loader');
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadFromString', () => {
    it('should parse valid YAML string', () => {
      const yaml = `
name: test-workflow
enabled: true
steps:
  - name: lint
    type: lint
    blocking: true
`;
      const config = loader.loadFromString(yaml);
      expect(config.name).toBe('test-workflow');
      expect(config.enabled).toBe(true);
      expect(config.steps).toHaveLength(1);
      expect(config.steps[0].name).toBe('lint');
    });

    it('should throw error for invalid YAML', () => {
      const invalidYaml = 'name: test\ninvalid: [unclosed';
      expect(() => loader.loadFromString(invalidYaml)).toThrow('Failed to parse YAML config');
    });

    it('should throw error for non-object result', () => {
      const yaml = 'just a string';
      expect(() => loader.loadFromString(yaml)).toThrow('Invalid YAML: parsed result is not an object');
    });
  });

  describe('loadFromFile', () => {
    it('should load config from YAML file', async () => {
      const configPath = join(testDir, '.review.yml');
      const yaml = `
name: file-workflow
enabled: true
steps:
  - name: test
    type: test
    blocking: true
`;
      await writeFile(configPath, yaml);

      const config = await loader.loadFromFile(configPath);
      expect(config.name).toBe('file-workflow');
      expect(config.steps).toHaveLength(1);
    });

    it('should throw error for missing file', async () => {
      const configPath = join(testDir, 'missing.yml');
      await expect(loader.loadFromFile(configPath)).rejects.toThrow();
    });

    it('should support .yaml extension', async () => {
      const configPath = join(testDir, '.review.yaml');
      const yaml = 'name: yaml-ext\nenabled: true\nsteps: []';
      await writeFile(configPath, yaml);

      const config = await loader.loadFromFile(configPath);
      expect(config.name).toBe('yaml-ext');
    });
  });

  describe('loadFromUrl', () => {
    it('should load config from URL', async () => {
      // Mock fetch
      const originalFetch = global.fetch;
      global.fetch = async (url: string | URL | Request) => {
        return {
          ok: true,
          text: async () => 'name: url-workflow\nenabled: true\nsteps: []',
        } as Response;
      };

      const config = await loader.loadFromUrl('https://example.com/.review.yml');
      expect(config.name).toBe('url-workflow');

      global.fetch = originalFetch;
    });

    it('should throw error for HTTP error', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response;
      };

      await expect(loader.loadFromUrl('https://example.com/.review.yml')).rejects.toThrow('HTTP 404: Not Found');

      global.fetch = originalFetch;
    });

    it('should throw error for network failure', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };

      await expect(loader.loadFromUrl('https://example.com/.review.yml')).rejects.toThrow('Failed to load config from URL');

      global.fetch = originalFetch;
    });
  });

  describe('loadOrgConfig', () => {
    it('should load from .github/.review.yml', async () => {
      const githubDir = join(testDir, '.github');
      await mkdir(githubDir, { recursive: true });
      const configPath = join(githubDir, '.review.yml');
      await writeFile(configPath, 'name: org-config\nenabled: true\nsteps: []');

      // Change working directory
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const config = await loader.loadOrgConfig('test-org');
      expect(config?.name).toBe('org-config');

      process.chdir(originalCwd);
    });

    it('should return null if no org config found', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const config = await loader.loadOrgConfig('test-org');
      expect(config).toBeNull();

      process.chdir(originalCwd);
    });

    it('should try multiple patterns', async () => {
      const configPath = join(testDir, '.review-org.yml');
      await writeFile(configPath, 'name: org-pattern\nenabled: true\nsteps: []');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      const config = await loader.loadOrgConfig('test-org');
      expect(config?.name).toBe('org-pattern');

      process.chdir(originalCwd);
    });
  });

  describe('loadRepoConfig', () => {
    it('should load from .review.yml', async () => {
      const configPath = join(testDir, '.review.yml');
      await writeFile(configPath, 'name: repo-config\nenabled: true\nsteps: []');

      const config = await loader.loadRepoConfig(testDir);
      expect(config?.name).toBe('repo-config');
    });

    it('should load from .github/.review.yml', async () => {
      const githubDir = join(testDir, '.github');
      await mkdir(githubDir, { recursive: true });
      const configPath = join(githubDir, '.review.yml');
      await writeFile(configPath, 'name: github-repo-config\nenabled: true\nsteps: []');

      const config = await loader.loadRepoConfig(testDir);
      expect(config?.name).toBe('github-repo-config');
    });

    it('should return null if no repo config found', async () => {
      const config = await loader.loadRepoConfig(testDir);
      expect(config).toBeNull();
    });
  });

  describe('loadEnvConfig', () => {
    it('should load environment-specific config', async () => {
      const configPath = join(testDir, '.review-dev.yml');
      await writeFile(configPath, 'name: dev-config\nenabled: true\nsteps: []');

      const config = await loader.loadEnvConfig(testDir, 'dev');
      expect(config?.name).toBe('dev-config');
    });

    it('should support .yaml extension', async () => {
      const configPath = join(testDir, '.review-prod.yaml');
      await writeFile(configPath, 'name: prod-config\nenabled: true\nsteps: []');

      const config = await loader.loadEnvConfig(testDir, 'prod');
      expect(config?.name).toBe('prod-config');
    });

    it('should return null if no env config found', async () => {
      const config = await loader.loadEnvConfig(testDir, 'staging');
      expect(config).toBeNull();
    });
  });

  describe('loadConfig', () => {
    it('should load and merge configs with priority', async () => {
      // Create repo config
      const repoPath = join(testDir, '.review.yml');
      await writeFile(repoPath, 'name: repo\nenabled: true\nsteps:\n  - name: lint\n    type: lint\n    blocking: true');

      // Create env config
      const envPath = join(testDir, '.review-dev.yml');
      await writeFile(envPath, 'name: dev\nenabled: false\nsteps: []');

      const config = await loader.loadConfig(testDir, undefined, 'dev');
      // Should use env config (higher priority)
      expect(config.name).toBe('dev');
      expect(config.enabled).toBe(false);
    });

    it('should throw error if no config found', async () => {
      await expect(loader.loadConfig(testDir)).rejects.toThrow('No configuration found');
    });

    it('should return single config if only one found', async () => {
      const configPath = join(testDir, '.review.yml');
      await writeFile(configPath, 'name: single\nenabled: true\nsteps: []');

      const config = await loader.loadConfig(testDir);
      expect(config.name).toBe('single');
    });
  });
});
