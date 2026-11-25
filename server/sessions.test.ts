import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PromptQueues } from './queue.js';
import { ChatStore } from './store.js';
import { PiSessions } from './pi-sessions.js';
import { AgentService } from './agent.js';

test('prompt queues preserve order and recover in-flight prompts paused after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-queue-'));
  try {
    const queue = new PromptQueues(dir);
    const first = queue.add('chat', 'First'), second = queue.add('chat', 'Second');
    assert.equal(queue.take('chat')?.id, first.id); assert.equal(queue.take('chat'), undefined);
    const recovered = new PromptQueues(dir);
    assert.equal(recovered.state('chat').paused, true);
    assert.deepEqual(recovered.state('chat').items.map(p => p.text), ['First', 'Second']);
    recovered.pause('chat', false); assert.equal(recovered.take('chat')?.text, 'First'); recovered.complete('chat');
    recovered.remove('chat', second.id); assert.equal(recovered.state('chat').items.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Pi session browser lists, previews, and forks without mutating the source session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-import-'));
  try {
    const cwd = join(dir, 'workspace'), sessions = join(dir, 'pi-sessions'); mkdirSync(cwd);
    const manager = SessionManager.create(cwd, sessions);
    manager.appendMessage({ role: 'user', content: 'Hello from terminal', timestamp: Date.now() });
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Hello from Pi' }], api: 'openai-responses', provider: 'openai', model: 'test', stopReason: 'stop', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const source = manager.getSessionFile()!, before = readFileSync(source, 'utf8');
    const store = new ChatStore(join(dir, 'app-data')), browser = new PiSessions(store, sessions);
    const listing = await browser.list(); assert.equal(listing.total, 1);
    assert.equal((await browser.preview(listing.sessions[0].key)).messages[0].text, 'Hello from terminal');
    const imported = await browser.import(listing.sessions[0].key);
    assert.notEqual(imported.sessionFile, source); assert.equal(readFileSync(source, 'utf8'), before);
    assert.equal(SessionManager.open(imported.sessionFile!).buildSessionContext().messages.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('each conversation runs its own queue sequentially while other sessions run independently', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-parallel-'));
  const store = new ChatStore(dir), agents = new AgentService(store);
  const order: string[] = []; let active = 0, peak = 0;
  function fakeSession() {
    const messages: { role: string; content: string; stopReason?: string }[] = [];
    return { messages, state: {}, getContextUsage: () => ({ tokens: 12, contextWindow: 1000, percent: 1.2 }), abort: async () => {}, dispose: () => {},
      prompt: async (text: string) => { active++; peak = Math.max(peak, active); order.push(`start:${text}`); messages.push({ role: 'user', content: text }); await new Promise(r => setTimeout(r, 35)); messages.push({ role: 'assistant', content: 'done', stopReason: 'stop' }); order.push(`end:${text}`); active--; },
    };
  }
  try {
    const a = store.create(dir), b = store.create(dir);
    const internals = agents as unknown as { sessions: Map<string, unknown> };
    internals.sessions.set(a.id, fakeSession()); internals.sessions.set(b.id, fakeSession());
    const first = agents.prompt(a, 'A1'); agents.enqueue(a, 'A2'); agents.enqueue(b, 'B1');
    await first;
    for (let i = 0; i < 100 && (agents.busy(a.id) || agents.busy(b.id)); i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(order.indexOf('end:A1') < order.indexOf('start:A2')); assert.equal(peak, 2);
    assert.equal(agents.queues.state(a.id).items.length, 0); assert.equal(store.get(a.id)?.contextUsage?.tokens, 12);
  } finally { await agents.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
