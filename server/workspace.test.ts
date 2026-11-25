import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changes, fileDiff, parseStatus } from './git.js';
import { ActivityLog } from './activity.js';
import { discoverTasks, PipelineService } from './pipelines.js';

test('read-only Git diff handles combined staged edits, new files, and path validation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-git-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  try {
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(dir, 'file.txt'), 'original\n'); git('add', '.'); git('commit', '-m', 'initial');
    writeFileSync(join(dir, 'file.txt'), 'staged\n'); git('add', '.'); writeFileSync(join(dir, 'file.txt'), 'working\n');
    writeFileSync(join(dir, 'new file.txt'), 'hello\n');
    const state = await changes(dir); assert.equal(state.available, true); assert.equal(state.files.length, 2);
    const patch = await fileDiff(dir, 'file.txt', true); assert.match(patch.patch, /-original/); assert.match(patch.patch, /\+working/);
    assert.match((await fileDiff(dir, 'new file.txt')).patch, /\+hello/);
    await assert.rejects(fileDiff(dir, '../private.txt'), /not in the current/);
    assert.equal(readFileSync(join(dir, 'file.txt'), 'utf8'), 'working\n');
    assert.equal(parseStatus('R  new\0old\0')[0].oldPath, 'old');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('activity persists completed rows and marks unfinished events interrupted after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-events-'));
  try {
    const log = new ActivityLog(dir);
    const id = log.start('chat', 'tool', 'write', 'file.ts');
    log.update('chat', id, { status: 'passed' }); log.start('chat', 'agent', 'Interrupted run');
    const loaded = new ActivityLog(dir).list('chat');
    assert.equal(loaded[0].status, 'passed'); assert.equal(loaded[1].status, 'interrupted');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('configured local tests stream logs, pass, fail, stop, and reject unknown commands', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-tests-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {
    test: 'node -e "console.log(123)"', 'test:fail': 'node -e "process.exit(1)"', 'test:slow': 'node -e "setTimeout(()=>{},30000)"', 'test:watch': 'node --watch test.js', dev: 'vite',
  } }));
  const log = new ActivityLog(join(dir, 'events'));
  const service = new PipelineService(log, () => {});
  const record = { id: 'chat', cwd: dir, title: 'Tests', createdAt: '', updatedAt: '' };
  async function wait() { for (let i = 0; i < 100 && service.busy(record.id); i++) await new Promise(r => setTimeout(r, 70)); assert.equal(service.busy(record.id), false); }
  try {
    assert.equal((await discoverTasks(dir)).length, 3);
    await assert.rejects(service.start(record, 'arbitrary'), /not configured/);
    await service.start(record, 'package:test'); await wait();
    assert.equal(log.list('chat').at(-1)?.status, 'passed'); assert.match(log.list('chat').at(-1)?.detail ?? '', /123/);
    await service.start(record, 'package:test:fail'); await wait(); assert.equal(log.list('chat').at(-1)?.status, 'failed');
    await service.start(record, 'package:test:slow'); await service.stop(record.id); await wait(); assert.equal(log.list('chat').at(-1)?.status, 'stopped');
  } finally { await service.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
