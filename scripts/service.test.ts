import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ChatServerService, serviceConfig, servicePlist } from './service.ts';
import type { Run } from './process.ts';

test('launchd plist escapes paths and never persists API keys or terminal session variables', () => {
  const config = serviceConfig('/tmp/A&B/Chat', '/tmp/home', '/usr/local/bin/node', 501);
  const plist = servicePlist(config, {
    PATH: '/bin',
    OPENAI_API_KEY: 'do-not-store',
    PI_SESSION_ID: 'terminal-session',
  });
  assert.match(plist, /A&amp;B/);
  assert.match(plist, /KeepAlive/);
  assert.ok(!plist.includes('do-not-store'));
  assert.ok(!plist.includes('terminal-session'));
  const managed = servicePlist(
    { ...config, dataDir: '/tmp/independent-data' },
    { CHAT_UPDATE_CHECK: '0', GITHUB_TOKEN: 'secret-token' },
  );
  assert.match(managed, /CHAT_UPDATE_CHECK<\/key><string>0<\/string>/);
  assert.match(managed, /CHAT_DATA_DIR<\/key><string>\/tmp\/independent-data<\/string>/);
  assert.ok(!managed.includes('secret-token'));
});
test('service start is idempotent and stop removes login startup without killing foreign processes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-service-'));
  const config = serviceConfig(join(dir, 'Chat'), join(dir, 'home'), process.execPath, 501);
  for (const file of [
    'node_modules/tsx/dist/loader.mjs',
    'node_modules/typescript/bin/tsc',
    'node_modules/vite/bin/vite.js',
    'server/index.ts',
  ]) {
    const path = join(config.root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }
  let loaded = false;
  const calls: string[] = [];
  const run: Run = async (command, args) => {
    calls.push(`${command} ${args.join(' ')}`);
    if (args[0] === 'print')
      return loaded
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 113, stdout: '', stderr: 'Could not find service' };
    if (args[0] === 'bootstrap') loaded = true;
    if (args[0] === 'bootout') loaded = false;
    return { code: 0, stdout: '', stderr: '' };
  };
  const service = new ChatServerService(config, {
    run,
    platform: 'darwin',
    probe: async () => (loaded ? { app: 'pi-chat', serviceId: config.label, pid: 123 } : undefined),
    portFree: async () => true,
  });
  try {
    assert.equal((await service.start()).healthy, true);
    assert.equal((await service.start()).alreadyRunning, true);
    assert.equal(calls.filter((c) => c.includes('bootstrap')).length, 1);
    await service.stop();
    assert.equal(loaded, false);
    assert.equal(existsSync(config.plist), false);
    const blocked = new ChatServerService(config, {
      run,
      platform: 'darwin',
      probe: async () => undefined,
      portFree: async () => false,
    });
    await assert.rejects(blocked.start(), /already in use/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
