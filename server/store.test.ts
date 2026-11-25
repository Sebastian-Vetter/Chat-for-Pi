import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from './store.js';
import { displayMessages } from './agent.js';

test('chat metadata survives reload, rename, and delete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-chat-store-'));
  try {
    const store = new ChatStore(dir);
    const chat = store.create('/tmp');
    store.update(chat.id, {
      title: 'Build Chat',
      sessionFile: '/tmp/session.jsonl',
      archived: true,
    });
    const reloaded = new ChatStore(dir);
    assert.equal(reloaded.get(chat.id)?.title, 'Build Chat');
    assert.equal(reloaded.get(chat.id)?.sessionFile, '/tmp/session.jsonl');
    assert.equal(reloaded.get(chat.id)?.archived, true);
    reloaded.update(chat.id, { archived: false });
    assert.equal(new ChatStore(dir).get(chat.id)?.archived, false);
    reloaded.delete(chat.id);
    assert.deepEqual(new ChatStore(dir).list(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('transcript includes partial streaming text, never hidden reasoning', () => {
  const messages = displayMessages(
    [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Private reasoning' },
          { type: 'text', text: 'Hi' },
        ],
      },
      { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'done' }] },
    ],
    { role: 'assistant', content: [{ type: 'text', text: 'Still streaming' }] },
  );
  assert.deepEqual(
    messages.map((m) => m.text),
    ['Hello', 'Hi', 'done', 'Still streaming'],
  );
  assert.equal(messages[2].toolName, 'bash');
});
test('provider errors remain visible even without assistant text', () => {
  const messages = displayMessages([
    { role: 'assistant', content: [], errorMessage: 'Invalid credentials' },
  ]);
  assert.equal(messages[0].text, 'Invalid credentials');
  assert.equal(messages[0].isError, true);
});
