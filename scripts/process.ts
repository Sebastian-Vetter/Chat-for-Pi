import { execFile } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Run = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

export const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Pass arguments directly to the process, never through a shell.
export const run: Run = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr: stderr || (error?.message ?? ''),
        });
      },
    );
  });
