import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppSettings } from './settings.js';
import { ChatStore } from './store.js';
import { AgentService } from './agent.js';

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for fake agent work');
}

test('queue policy defaults on, persists with revisions and notifies subscribers without exposing mutable state', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-settings-'));
  const path = join(root, 'settings.json');
  try {
    const settings = new AppSettings(path);
    assert.deepEqual(settings.read(), { queuesEnabled: true, revision: 0 });
    const changes: boolean[] = [];
    const unsubscribe = settings.subscribe((next) => changes.push(next.queuesEnabled));
    settings.update(false);
    settings.read().queuesEnabled = true;
    assert.deepEqual(new AppSettings(path).read(), { queuesEnabled: false, revision: 1 });
    settings.update(false);
    assert.deepEqual(changes, [false]);
    unsubscribe();
    settings.update(true);
    assert.deepEqual(changes, [false]);
    assert.equal(new AppSettings(path).read().revision, 2);
    writeFileSync(path, '{"queuesEnabled":"false","revision":3}');
    assert.throws(() => new AppSettings(path), /Invalid app settings/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('disabling queues keeps active work running, blocks enqueue/resume/drain and preserves pending work until explicitly resumed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-queue-policy-'));
  const store = new ChatStore(root);
  const agents = new AgentService(store);
  const a = store.create(root),
    b = store.create(root);
  const started: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const messages: { role: string; content: string; stopReason?: string }[] = [];
  (agents as unknown as { sessions: Map<string, unknown> }).sessions.set(a.id, {
    messages,
    state: {},
    getContextUsage: () => undefined,
    abort: async () => release(),
    dispose: () => {},
    prompt: async (text: string) => {
      started.push(text);
      messages.push({ role: 'user', content: text });
      if (text === 'current') await gate;
      messages.push({ role: 'assistant', content: 'Done', stopReason: 'stop' });
    },
  });
  try {
    const current = agents.prompt(a, 'current');
    await waitFor(() => started.includes('current'));
    agents.enqueue(a, 'next');
    agents.pauseQueue(b, true);
    agents.enqueue(b, 'other chat');
    agents.setQueuesEnabled(false);
    assert.equal(agents.busy(a.id), true);
    assert.throws(() => agents.enqueue(a, 'rejected'), /disabled/);
    assert.throws(() => agents.pauseQueue(a, false), /disabled/);
    assert.equal(agents.queues.state(a.id).paused, true);
    // The global drain guard also holds if an unpaused state is encountered internally.
    agents.queues.pause(a.id, false);
    release();
    await current;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(started, ['current']);
    assert.equal(agents.queues.state(a.id).items[0].text, 'next');
    assert.equal(agents.queues.state(b.id).items[0].text, 'other chat');
    assert.equal(agents.queues.state(a.id).paused, false);
    assert.equal(new AppSettings(join(root, 'settings.json')).read().queuesEnabled, false);
    agents.setQueuesEnabled(true);
    assert.equal(agents.queues.state(a.id).paused, true);
    assert.equal(agents.busy(a.id), false);
    agents.pauseQueue(a, false);
    await waitFor(() => started.includes('next') && !agents.busy(a.id));
    assert.deepEqual(started, ['current', 'next']);
    assert.equal(agents.queues.state(b.id).paused, true);
  } finally {
    release();
    await agents.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});
