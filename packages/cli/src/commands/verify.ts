import { spawn } from 'child_process';

export interface VerifyOptions {
  pr?: number;
  comment?: boolean;
}

export interface VerifyResult {
  passed: boolean;
  summary: string;
  exitCode: number;
}

/**
 * Run the verify skill via Claude Code.
 *
 * Invokes `claude /verify` with optional flags for PR commenting.
 * Parses the output for [VERIFY:RESULT] to determine pass/fail.
 */
export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  const args = ['/verify'];

  if (options.pr !== undefined) {
    args.push('--pr', options.pr.toString());
  }

  if (options.comment) {
    args.push('--comment');
  }

  return new Promise((resolve) => {
    const claude = spawn('claude', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';

    claude.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    claude.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(text);
    });

    claude.on('close', (code) => {
      const exitCode = code ?? 1;

      // Parse [VERIFY:RESULT] from output
      const resultMatch = stdout.match(/\[VERIFY:RESULT\]\s*({.*})/);

      if (resultMatch && resultMatch[1]) {
        try {
          const result = JSON.parse(resultMatch[1]) as { passed: boolean; summary: string };
          resolve({
            passed: result.passed,
            summary: result.summary,
            exitCode: result.passed ? 0 : 1,
          });
          return;
        } catch {
          // Failed to parse result JSON
        }
      }

      // Fallback: use exit code
      resolve({
        passed: exitCode === 0,
        summary: exitCode === 0 ? 'Verification passed' : 'Verification failed',
        exitCode,
      });
    });

    claude.on('error', (error) => {
      console.error(`Failed to start claude: ${error.message}`);
      resolve({
        passed: false,
        summary: `Failed to start claude: ${error.message}`,
        exitCode: 2,
      });
    });
  });
}
