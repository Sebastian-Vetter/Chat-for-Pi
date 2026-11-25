import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { npmCommand, run } from './process.ts';
import { releaseArtifacts } from './release-info.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, '.release'),
  temp = await mkdtemp(join(tmpdir(), 'pi-chat-package-'));
async function checked(command: string, args: string[], cwd?: string) {
  const result = await run(command, args, cwd);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout;
}
try {
  const checksums = await readFile(join(output, 'SHA256SUMS'), 'utf8');
  for (const file of Object.values(releaseArtifacts(version))) {
    assert.ok(
      checksums.includes(
        `${createHash('sha256')
          .update(await readFile(join(output, file)))
          .digest('hex')}  ${file}`,
      ),
    );
    const listing = await checked('tar', ['-tzf', join(output, file)]);
    for (const path of listing.trim().split('\n')) {
      assert.ok(/^(package|app)\//.test(path), `Unexpected archive root: ${path}`);
      assert.ok(
        !path
          .split('/')
          .some((part) =>
            ['..', '.env', '.data', '.git', 'node_modules', 'AGENTS.md'].includes(part),
          ),
        `Private file packaged: ${path}`,
      );
    }
    await checked('tar', ['-xzf', join(output, file), '-C', temp]);
  }
  const manifest = JSON.parse(await readFile(join(temp, 'package', 'package.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.dependencies, undefined);
  assert.ok(manifest.peerDependencies['@earendil-works/pi-coding-agent']);
  const extension = await import(
    pathToFileURL(join(temp, 'package', 'extensions', 'distribution.mjs')).href
  );
  let registered = '';
  extension.default({
    registerCommand: (name: string) => {
      registered = name;
    },
  });
  assert.equal(registered, 'chat-server');
  const app = join(temp, 'app');
  await checked(npmCommand, ['ci', '--include=dev'], app);
  // Verify the shipped source, not this checkout's node_modules or formatter settings.
  await checked(npmCommand, ['run', 'check'], app);
  await checked(npmCommand, ['run', 'build'], app);
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(join(app, 'node_modules/tsx/dist/loader.mjs')).href,
      join(app, 'server/index.ts'),
    ],
    {
      cwd: app,
      env: {
        PATH: process.env.PATH,
        HOME: temp,
        PORT: String(port),
        CHAT_DATA_DIR: join(temp, 'data'),
        CHAT_UPDATE_CHECK: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    const config = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    assert.equal(config.version, version);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    assert.equal(
      (await (await fetch(`http://127.0.0.1:${port}/api/updates`)).json()).status,
      'disabled',
    );
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((resolve) =>
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000).unref(),
      ),
    ]);
  }
  console.log(
    'Verified checksums, package privacy, dependency-free Pi extension loading, and clean standalone build/server startup. No live-provider calls.',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
