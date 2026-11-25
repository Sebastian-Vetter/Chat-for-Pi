import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { npmCommand, run, type Run } from './process.ts';
import { isStableVersion } from './release-info.ts';

// Explicit allowlist: never copy Git, credentials, local settings, node_modules, or sessions.
export const APPLICATION_FILES = [
  'package.json',
  'package-lock.json',
  'README.md',
  'CHANGELOG.md',
  'index.html',
  'tsconfig.json',
  'vite.config.ts',
  '.prettierrc.json',
  '.prettierignore',
  'src',
  'server',
  'scripts',
  'extensions',
];
export async function copyApplication(source: string, target: string) {
  for (const file of APPLICATION_FILES) {
    const sourcePath = join(source, file);
    await cp(sourcePath, join(target, file), {
      recursive: true,
      filter: async (path) => {
        const name = basename(path);
        const isHiddenChild = path !== sourcePath && name.startsWith('.');
        if (isHiddenChild || name === 'node_modules') return false;
        return !(await lstat(path)).isSymbolicLink();
      },
    });
  }
}
export function installationPaths(home = homedir()) {
  const base = join(home, '.local', 'share', 'pi-chat');
  return { base, root: join(base, 'app'), data: join(base, 'data') };
}
export async function assertServerStopped() {
  await new Promise<void>((resolve, reject) => {
    const socket = createServer();
    socket.once('error', () =>
      reject(
        new Error(
          'Port 3001 is in use. Finish active runs and stop Chat explicitly before installing. No server was stopped.',
        ),
      ),
    );
    socket.listen(3001, '127.0.0.1', () => socket.close(() => resolve()));
  });
}
export async function installApplication(
  source: string,
  home = homedir(),
  dependencies: { run?: Run; assertStopped?: () => Promise<void> } = {},
) {
  const paths = installationPaths(home),
    execute = dependencies.run ?? run,
    assertStopped = dependencies.assertStopped ?? assertServerStopped;
  const version = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
  if (!isStableVersion(version)) throw new Error('Invalid application version.');
  await mkdir(paths.base, { recursive: true, mode: 0o700 });
  const lock = join(paths.base, '.install-lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(`Another installation is active (${lock}).`);
    throw error;
  }
  let staging: string | undefined;
  const backup = join(paths.base, `previous-app-${randomUUID()}`);
  try {
    await assertStopped();
    staging = await mkdtemp(join(paths.base, '.install-'));
    await copyApplication(source, staging);
    for (const args of [
      ['ci', '--include=dev'],
      ['run', 'build'],
    ]) {
      const result = await execute(npmCommand, args, staging);
      if (result.code !== 0)
        throw new Error(
          `npm ${args.join(' ')} failed: ${(result.stderr || result.stdout).slice(-4000)}`,
        );
    }
    await assertStopped();
    await mkdir(paths.data, { recursive: true, mode: 0o700 });
    const existed = existsSync(paths.root);
    if (existed) await rename(paths.root, backup);
    try {
      await rename(staging, paths.root);
      staging = undefined;
    } catch (error) {
      if (existed) await rename(backup, paths.root);
      throw error;
    }
    return { ...paths, version, previous: existed ? backup : undefined };
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
