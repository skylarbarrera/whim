#!/usr/bin/env node
import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { Dashboard } from './commands/dashboard.js';
import { loadConfig } from './config.js';
import { runVerify } from './commands/verify.js';
import { runInit } from './commands/init.js';

const config = loadConfig();
const defaultApiUrl = config.apiUrl || process.env.ORCHESTRATOR_URL || 'http://localhost:3002';

const program = new Command();

program
  .name('whim')
  .description('Terminal dashboard for monitoring and managing Whim')
  .version('0.1.0');

program
  .command('dashboard', { isDefault: true })
  .description('Show the main dashboard (default)')
  .option('--api-url <url>', 'Orchestrator API URL', defaultApiUrl)
  .action((options) => {
    render(<Dashboard apiUrl={options.apiUrl} />);
  });

program
  .command('status')
  .description('Show quick status summary')
  .option('--api-url <url>', 'Orchestrator API URL', defaultApiUrl)
  .action(async (options) => {
    try {
      const response = await fetch(`${options.apiUrl}/api/status`);
      if (!response.ok) {
        console.error(`Error: HTTP ${response.status}`);
        process.exit(1);
      }
      const data = await response.json() as {
        status: string;
        metrics: {
          activeWorkers: number;
          queuedItems: number;
          completedToday: number;
          failedToday: number;
        };
      };
      console.log(
        `Whim: ${data.status} | Workers: ${data.metrics.activeWorkers} | Queue: ${data.metrics.queuedItems} | Today: ${data.metrics.completedToday} completed, ${data.metrics.failedToday} failed`
      );
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Run AI-driven verification via Claude Code')
  .option('--pr <number>', 'PR number for commenting', parseInt)
  .option('--comment', 'Post results as PR comment')
  .action(async (options: { pr?: number; comment?: boolean }) => {
    if (options.comment && options.pr === undefined) {
      console.error('Error: --comment requires --pr <number>');
      process.exit(2);
    }

    const result = await runVerify({
      pr: options.pr,
      comment: options.comment,
    });

    process.exit(result.exitCode);
  });

program
  .command('init')
  .description('Initialize Whim in a repository')
  .option('-y, --yes', 'Non-interactive mode, accept defaults')
  .action(async (options: { yes?: boolean }) => {
    try {
      await runInit({ yes: options.yes });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
