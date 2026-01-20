import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface CliConfig {
  apiUrl?: string;
}

export function loadConfig(): CliConfig {
  const configPath = join(homedir(), '.whimrc');
  const config: CliConfig = {};

  try {
    const content = readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue; // Skip empty lines and comments
      }

      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();

      if (key?.trim() === 'apiUrl') {
        config.apiUrl = value;
      }
    }
  } catch (error) {
    // Config file doesn't exist or can't be read - that's OK
    // User can rely on defaults or CLI flags
    console.debug(`[CONFIG] Config file not loaded: ${error instanceof Error ? error.message : String(error)}`);
  }

  return config;
}
