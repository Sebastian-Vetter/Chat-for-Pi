import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { APPLICATION_FILES, installApplication, installationPaths } from './install-app.ts';

test('installer stages builds, preserves independent data and rollback code, and never stops a server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-chat-install-')), source = join(dir, 'source'), home = join(dir, 'home');
  try {
    await mkdir(source);
    for (const file of APPLICATION_FILES) {
      if (['src', 'server', 'scripts', 'extensions'].includes(file)) await mkdir(join(source, file));
      else await writeFile(join(source, file), file === 'package.json' ? JSON.stringify({ version: '1.0.5' }) : 'fixture');
    }
    await writeFile(join(source, '.env'), 'SECRET'); await writeFile(join(source, 'src', '.env'), 'SECRET');
    const paths = installationPaths(home); await mkdir(paths.data, { recursive: true }); await writeFile(join(paths.data, 'chats.json'), 'keep me');
    const calls: string[][] = []; let stoppedChecks = 0;
    const deps = { assertStopped: async () => { stoppedChecks++; }, run: async (command: string, args: string[]) => { assert.ok(command.startsWith('npm')); calls.push(args); return { code: 0, stdout: '', stderr: '' }; } };
    await installApplication(source, home, deps);
    assert.deepEqual(calls, [['ci', '--include=dev'], ['run', 'build']]); assert.equal(stoppedChecks, 2);
    assert.equal(await readFile(join(paths.data, 'chats.json'), 'utf8'), 'keep me');
    assert.equal(existsSync(join(paths.root, '.env')), false); assert.equal(existsSync(join(paths.root, 'src', '.env')), false);
    const second = await installApplication(source, home, deps); assert.ok(second.previous); assert.ok(existsSync(join(second.previous!, 'package.json')));
    await assert.rejects(installApplication(source, home, { ...deps, assertStopped: async () => { throw new Error('still running'); } }), /still running/);
    await assert.rejects(installApplication(source, home, { ...deps, run: async () => ({ code: 1, stdout: '', stderr: 'build failed' }) }), /build failed/);
    assert.equal(await readFile(join(paths.data, 'chats.json'), 'utf8'), 'keep me');
    assert.equal(JSON.parse(await readFile(join(paths.root, 'package.json'), 'utf8')).version, '1.0.5');
    assert.equal(existsSync(join(paths.base, '.install-lock')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
