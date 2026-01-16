#!/usr/bin/env bun
/**
 * Test script for temporary test generation feature.
 *
 * Usage:
 *   cd packages/verifier
 *   bun run scripts/test-temp-tests.ts
 *
 * This script tests the temp test generation in isolation without running
 * the full verifier or posting to GitHub.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildTempTestPrompt } from '../src/prompts/system.js';
import { parseTempTestOutput } from '../src/report/parser.js';

// Get the repo root (whim monorepo)
const repoRoot = path.resolve(import.meta.dir, '../../..');

console.log('=== Temporary Test Generation Test ===\n');

// 1. Get actual git diff from current branch
console.log('1. Getting git diff from main...');
const diffResult = Bun.spawnSync(['git', 'diff', 'main...HEAD', '--', 'packages/verifier'], {
  cwd: repoRoot,
});
const diff = diffResult.stdout.toString();
console.log(`   Found ${diff.split('\n').length} lines of diff\n`);

if (diff.length < 100) {
  console.log('   No significant changes in packages/verifier vs main');
  console.log('   Creating a mock diff for testing...\n');
}

// 2. Detect project type
console.log('2. Project type detection...');
const hasPackageJson = fs.existsSync(path.join(repoRoot, 'package.json'));
const hasPyproject = fs.existsSync(path.join(repoRoot, 'pyproject.toml'));
const hasGoMod = fs.existsSync(path.join(repoRoot, 'go.mod'));
console.log(`   package.json: ${hasPackageJson}`);
console.log(`   pyproject.toml: ${hasPyproject}`);
console.log(`   go.mod: ${hasGoMod}`);
console.log(`   Detected: node\n`);

// 3. Find existing tests related to changed files
console.log('3. Finding related tests...');
const changedFiles = diff.match(/\+\+\+ b\/(.+)/g) ?? [];
const changedPaths = changedFiles.map((f: string) => f.replace('+++ b/', ''));
console.log(`   Changed files: ${changedPaths.length}`);
changedPaths.slice(0, 5).forEach((p: string) => console.log(`   - ${p}`));
if (changedPaths.length > 5) console.log(`   ... and ${changedPaths.length - 5} more`);

// Find test files
const existingTests = changedPaths.filter((p: string) =>
  p.includes('.test.') || p.includes('.spec.') || p.includes('_test.')
);
console.log(`   Related test files: ${existingTests.length}`);
existingTests.forEach((t: string) => console.log(`   - ${t}`));
console.log();

// 4. Build the prompt (show truncated version)
console.log('4. Building temp test prompt...');
const prompt = buildTempTestPrompt({
  diff: diff.slice(0, 10000), // Truncate for demo
  existingTests,
  projectType: 'node',
});
console.log(`   Prompt length: ${prompt.length} chars`);
console.log(`   First 500 chars:\n`);
console.log('   ' + prompt.slice(0, 500).split('\n').join('\n   '));
console.log('   ...\n');

// 5. Test the parser with mock output
console.log('5. Testing parser with mock AI output...');
const mockAiOutput = `
Based on the diff, I identified coverage gaps in the temporary test generation feature.

\`\`\`json
{
  "tests": [
    {
      "filename": "temp-test-integration.test.ts",
      "description": "Tests that runTemporaryTests correctly generates and runs tests",
      "content": "import { describe, it, expect } from 'vitest';\\n\\ndescribe('Temporary Test Integration', () => {\\n  it('should detect project type correctly', () => {\\n    expect(true).toBe(true);\\n  });\\n});",
      "expectedToPass": true
    }
  ],
  "coverageGaps": [
    "runTemporaryTests function not tested with actual AI output",
    "cleanupTempTests not tested for error cases"
  ],
  "skippedReason": null
}
\`\`\`
`;

const parsed = parseTempTestOutput(mockAiOutput);
console.log(`   Parsed result:`);
console.log(`   - Tests generated: ${parsed.tests.length}`);
console.log(`   - Coverage gaps: ${parsed.coverageGaps.length}`);
console.log(`   - Skipped reason: ${parsed.skippedReason ?? 'none'}`);

if (parsed.tests.length > 0) {
  console.log(`\n   Generated test preview:`);
  console.log(`   Filename: ${parsed.tests[0].filename}`);
  console.log(`   Description: ${parsed.tests[0].description}`);
  console.log(`   Content (first 200 chars):`);
  console.log('   ' + parsed.tests[0].content.slice(0, 200));
}

console.log('\n=== Test Complete ===\n');

// 6. Option to run with actual AI
console.log('To test with actual AI generation, run:');
console.log('  bun run scripts/test-temp-tests.ts --live\n');

if (process.argv.includes('--live')) {
  console.log('=== Live AI Test ===\n');
  console.log('This would invoke Claude to generate actual tests.');
  console.log('Requires: ANTHROPIC_API_KEY environment variable.\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ERROR: ANTHROPIC_API_KEY not set. Set it and try again.\n');
  } else {
    // Import and run the actual function
    const { runAgent } = await import('../src/agent.js');
    console.log('Invoking AI (this may take a minute)...\n');
    const result = await runAgent(prompt, { cwd: repoRoot, timeoutMs: 180000 });
    console.log('Success:', result.success);
    console.log('Duration:', result.durationMs, 'ms');
    if (result.costUsd) console.log('Cost:', result.costUsd.toFixed(4), 'USD');
    console.log('\nAI Response (first 2000 chars):\n');
    console.log(result.output.slice(0, 2000));
  }
}
