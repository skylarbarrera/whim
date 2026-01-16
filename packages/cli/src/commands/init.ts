import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

// Types
export type ProjectType = 'web' | 'api' | 'cli' | 'library' | 'monorepo';
export type PackageManager = 'npm' | 'pnpm' | 'bun' | 'yarn';
export type HarnessType = 'claude-code' | 'codex' | 'opencode';
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'bun' | null;

export interface InitOptions {
  yes?: boolean;
}

export interface DetectionResult {
  projectType: ProjectType;
  packageManager: PackageManager;
  testFramework: TestFramework;
  harnesses: HarnessType[];
  isMonorepo: boolean;
  monorepoPackages?: { path: string; type: ProjectType }[];
}

export interface InitResult {
  detection: DetectionResult;
  selectedHarness: HarnessType | null;
  configsCreated: string[];
  skillsInstalled: string[];
  depsInstalled: string[];
  warnings: string[];
}

// Detection functions
export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function detectTestFramework(cwd: string): TestFramework {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps.vitest) return 'vitest';
    if (allDeps.jest) return 'jest';
    if (allDeps.mocha) return 'mocha';

    // Check if using bun test (bun projects often don't have explicit test dep)
    if (existsSync(join(cwd, 'bun.lockb'))) {
      const scripts = pkg.scripts || {};
      if (scripts.test?.includes('bun test')) return 'bun';
    }
  } catch {
    // Invalid package.json
  }

  return null;
}

export function detectProjectType(cwd: string): { type: ProjectType; isMonorepo: boolean; packages?: { path: string; type: ProjectType }[] } {
  // Check for monorepo signals first
  const pkgPath = join(cwd, 'package.json');
  let pkg: Record<string, unknown> = {};

  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      // Invalid package.json
    }
  }

  const hasWorkspaces = Boolean(pkg.workspaces);
  const hasPnpmWorkspace = existsSync(join(cwd, 'pnpm-workspace.yaml'));
  const hasTurbo = existsSync(join(cwd, 'turbo.json'));
  const hasNx = existsSync(join(cwd, 'nx.json'));

  if (hasWorkspaces || hasPnpmWorkspace || hasTurbo || hasNx) {
    // Detect package types within monorepo
    const packages: { path: string; type: ProjectType }[] = [];

    // Common monorepo directories
    const packageDirs = ['packages', 'apps', 'libs'];
    for (const dir of packageDirs) {
      const dirPath = join(cwd, dir);
      if (existsSync(dirPath)) {
        try {
          const entries = require('fs').readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const subPath = join(dir, entry.name);
              const subType = detectSingleProjectType(join(cwd, subPath));
              packages.push({ path: subPath, type: subType });
            }
          }
        } catch {
          // Can't read directory
        }
      }
    }

    return { type: 'monorepo', isMonorepo: true, packages };
  }

  return { type: detectSingleProjectType(cwd), isMonorepo: false };
}

function detectSingleProjectType(cwd: string): ProjectType {
  const pkgPath = join(cwd, 'package.json');

  // Check for index.html (web)
  if (existsSync(join(cwd, 'index.html')) || existsSync(join(cwd, 'public', 'index.html'))) {
    return 'web';
  }

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Web frameworks
      if (allDeps.react || allDeps.vue || allDeps.svelte || allDeps['@angular/core'] || allDeps.next || allDeps.nuxt) {
        return 'web';
      }

      // API frameworks
      if (allDeps.express || allDeps.fastify || allDeps.hono || allDeps.koa || allDeps['@nestjs/core']) {
        return 'api';
      }

      // CLI indicators
      if (pkg.bin || allDeps.commander || allDeps.yargs || allDeps.meow) {
        return 'cli';
      }
    } catch {
      // Invalid package.json
    }
  }

  // Default to library
  return 'library';
}

export function detectHarnesses(): HarnessType[] {
  const harnesses: HarnessType[] = [];

  try {
    const claudeResult = spawnSync('which', ['claude'], { encoding: 'utf-8' });
    if (claudeResult.status === 0 && claudeResult.stdout.trim()) {
      harnesses.push('claude-code');
    }
  } catch {
    // claude not found
  }

  try {
    const codexResult = spawnSync('which', ['codex'], { encoding: 'utf-8' });
    if (codexResult.status === 0 && codexResult.stdout.trim()) {
      harnesses.push('codex');
    }
  } catch {
    // codex not found
  }

  try {
    const opencodeResult = spawnSync('which', ['opencode'], { encoding: 'utf-8' });
    if (opencodeResult.status === 0 && opencodeResult.stdout.trim()) {
      harnesses.push('opencode');
    }
  } catch {
    // opencode not found
  }

  return harnesses;
}

// Interactive prompts
async function promptChoice(question: string, options: string[]): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(question);
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));

    rl.question('Enter choice (number): ', (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length && options[idx]) {
        resolve(options[idx] as string);
      } else {
        resolve(options[0] as string); // Default to first
      }
    });
  });
}

// Installation functions
function getInstallCommand(pm: PackageManager, deps: string[], dev: boolean): string {
  const devFlag = dev ? (pm === 'npm' ? '--save-dev' : '-D') : '';
  switch (pm) {
    case 'bun':
      return `bun add ${devFlag} ${deps.join(' ')}`;
    case 'pnpm':
      return `pnpm add ${devFlag} ${deps.join(' ')}`;
    case 'yarn':
      return `yarn add ${devFlag} ${deps.join(' ')}`;
    default:
      return `npm install ${devFlag} ${deps.join(' ')}`;
  }
}

function installDependencies(cwd: string, pm: PackageManager, deps: string[], dev: boolean): boolean {
  if (deps.length === 0) return true;

  const cmd = getInstallCommand(pm, deps, dev);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function installSkills(cwd: string, harness: HarnessType): string[] {
  const installed: string[] = [];

  // Install Ralph skills
  try {
    execSync('npx add-skill skylarbarrera/ralph -y', { cwd, stdio: 'inherit' });
    installed.push('ralph');
  } catch {
    console.warn('Warning: Failed to install Ralph skills');
  }

  // Install Whim verify skill
  // Note: In production, this would be the actual whim repo URL
  try {
    execSync('npx add-skill whim-ai/whim --skill verify -y', { cwd, stdio: 'inherit' });
    installed.push('verify');
  } catch {
    console.warn('Warning: Failed to install Whim verify skill');
  }

  return installed;
}

// Config generation
function generateRalphConfig(harness: HarnessType): string {
  return `# Ralph configuration
harness: ${harness}
`;
}

function generateWhimConfig(
  projectType: ProjectType,
  isMonorepo: boolean,
  packages?: { path: string; type: ProjectType }[]
): string {
  if (isMonorepo && packages && packages.length > 0) {
    const packagesYaml = packages
      .map((pkg) => {
        const verification = getVerificationForType(pkg.type);
        return `  - path: ${pkg.path}
    type: ${pkg.type}
    verification:
      enabled: true
${Object.entries(verification)
  .map(([k, v]) => `      ${k}: ${v}`)
  .join('\n')}`;
      })
      .join('\n');

    return `# Whim configuration
type: monorepo

verification:
  enabled: true

packages:
${packagesYaml}
`;
  }

  const verification = getVerificationForType(projectType);
  return `# Whim configuration
type: ${projectType}

verification:
  enabled: true
${Object.entries(verification)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n')}
`;
}

function getVerificationForType(type: ProjectType): Record<string, boolean> {
  switch (type) {
    case 'web':
      return { browser: true, unit: true };
    case 'api':
      return { api: true, unit: true };
    default:
      return { unit: true };
  }
}

function writeConfig(cwd: string, dir: string, filename: string, content: string): string {
  const configDir = join(cwd, dir);
  const configPath = join(configDir, filename);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(configPath, content);
  return join(dir, filename);
}

// Main init function
export async function runInit(options: InitOptions): Promise<InitResult> {
  const cwd = process.cwd();
  const warnings: string[] = [];

  console.log('Initializing Whim...\n');

  // 1. Detect project
  console.log('Detecting project configuration...');
  const packageManager = detectPackageManager(cwd);
  const testFramework = detectTestFramework(cwd);
  const { type: projectType, isMonorepo, packages: monorepoPackages } = detectProjectType(cwd);
  const harnesses = detectHarnesses();

  console.log(`  Package manager: ${packageManager}`);
  console.log(`  Project type: ${projectType}${isMonorepo ? ' (monorepo)' : ''}`);
  console.log(`  Test framework: ${testFramework || 'none detected'}`);
  console.log(`  AI harnesses: ${harnesses.length > 0 ? harnesses.join(', ') : 'none detected'}`);
  console.log();

  const detection: DetectionResult = {
    projectType,
    packageManager,
    testFramework,
    harnesses,
    isMonorepo,
    monorepoPackages,
  };

  // 2. Select harness
  let selectedHarness: HarnessType | null = null;

  if (harnesses.length === 0) {
    warnings.push('No AI harness detected. Install Claude Code, Codex, or OpenCode.');
    console.warn('Warning: No AI harness detected. Skills will not work without one.');
  } else if (harnesses.length === 1 && harnesses[0]) {
    selectedHarness = harnesses[0];
    console.log(`Using harness: ${selectedHarness}`);
  } else if (options.yes && harnesses[0]) {
    selectedHarness = harnesses[0];
    console.log(`Using harness: ${selectedHarness} (first available)`);
  } else {
    const choice = await promptChoice('Multiple AI harnesses detected. Choose default:', harnesses);
    selectedHarness = choice as HarnessType;
  }
  console.log();

  // 3. Install dependencies
  console.log('Checking dependencies...');
  const depsInstalled: string[] = [];

  // Install test framework if missing
  if (!testFramework) {
    console.log('  Installing vitest (no test framework detected)...');
    if (installDependencies(cwd, packageManager, ['vitest'], true)) {
      depsInstalled.push('vitest');
    } else {
      warnings.push('Failed to install vitest');
    }
  }

  // Install browser testing for web projects
  if (projectType === 'web' || (isMonorepo && monorepoPackages?.some((p) => p.type === 'web'))) {
    console.log('  Installing playwright for browser testing...');
    if (installDependencies(cwd, packageManager, ['playwright', '@playwright/test'], true)) {
      depsInstalled.push('playwright');
      // Install browsers
      try {
        execSync('npx playwright install', { cwd, stdio: 'inherit' });
      } catch {
        warnings.push('Failed to install Playwright browsers');
      }
    } else {
      warnings.push('Failed to install playwright');
    }
  }
  console.log();

  // 4. Install skills
  console.log('Installing skills...');
  const skillsInstalled = selectedHarness ? installSkills(cwd, selectedHarness) : [];
  console.log();

  // 5. Generate config files
  console.log('Generating configuration files...');
  const configsCreated: string[] = [];

  if (selectedHarness) {
    const ralphConfig = generateRalphConfig(selectedHarness);
    const ralphPath = writeConfig(cwd, '.ralph', 'config.yml', ralphConfig);
    configsCreated.push(ralphPath);
    console.log(`  Created ${ralphPath}`);
  }

  const whimConfig = generateWhimConfig(projectType, isMonorepo, monorepoPackages);
  const whimPath = writeConfig(cwd, '.whim', 'config.yml', whimConfig);
  configsCreated.push(whimPath);
  console.log(`  Created ${whimPath}`);
  console.log();

  // 6. Print summary
  console.log('='.repeat(50));
  console.log('Whim initialization complete!');
  console.log('='.repeat(50));
  console.log();

  console.log('Detected:');
  console.log(`  Project type: ${projectType}`);
  console.log(`  Package manager: ${packageManager}`);
  console.log(`  Test framework: ${testFramework || 'vitest (installed)'}`);
  if (selectedHarness) {
    console.log(`  AI harness: ${selectedHarness}`);
  }
  console.log();

  if (configsCreated.length > 0) {
    console.log('Created:');
    configsCreated.forEach((c) => console.log(`  ${c}`));
    console.log();
  }

  if (skillsInstalled.length > 0) {
    console.log('Installed skills:');
    skillsInstalled.forEach((s) => console.log(`  ${s}`));
    console.log();
  }

  if (depsInstalled.length > 0) {
    console.log('Installed dependencies:');
    depsInstalled.forEach((d) => console.log(`  ${d}`));
    console.log();
  }

  if (warnings.length > 0) {
    console.log('Warnings:');
    warnings.forEach((w) => console.log(`  - ${w}`));
    console.log();
  }

  console.log('Next steps:');
  console.log('  1. Review .whim/config.yml and adjust verification settings');
  if (selectedHarness) {
    console.log('  2. Run `whim verify` to test AI-driven verification');
  } else {
    console.log('  2. Install an AI harness (Claude Code recommended)');
  }
  console.log('  3. Create a GitHub issue or submit work via the Whim API');
  console.log();

  return {
    detection,
    selectedHarness,
    configsCreated,
    skillsInstalled,
    depsInstalled,
    warnings,
  };
}
