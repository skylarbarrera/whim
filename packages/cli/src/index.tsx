#!/usr/bin/env node
import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { Dashboard } from './commands/dashboard.js';

const program = new Command();

program
  .name('whim')
  .description('Terminal dashboard for monitoring and managing Whim')
  .version('0.1.0');

program
  .command('dashboard', { isDefault: true })
  .description('Show the main dashboard (default)')
  .option('--api-url <url>', 'Orchestrator API URL', 'http://localhost:3000')
  .action((options) => {
    render(<Dashboard />);
  });

program.parse(process.argv);
