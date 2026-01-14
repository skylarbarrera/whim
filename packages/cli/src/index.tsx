#!/usr/bin/env node
import { Command } from 'commander';
import React from 'react';
import { render, Text } from 'ink';

const program = new Command();

program
  .name('whim')
  .description('Terminal dashboard for monitoring and managing Whim')
  .version('0.1.0');

program
  .command('dashboard', { isDefault: true })
  .description('Show the main dashboard (default)')
  .action(() => {
    // For now, just show "Hello World" - dashboard will be implemented later
    render(<Text color="green">Hello World</Text>);
  });

program.parse(process.argv);
