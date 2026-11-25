import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from './agent.js';
import { ChatStore } from './store.js';

test('web subagent commands persist activation, reject unsupported commands and never send them to a model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-commands-'));
  const store = new ChatStore(dir),
    agents = new AgentService(store);
  let tools = ['read'];
  let prompts = 0;
  const record = store.create(dir);
  const session = {
    messages: [],
    state: {},
    getContextUsage() {},
    getActiveToolNames: () => tools,
    setActiveToolsByName: (names: string[]) => {
      tools = names;
    },
    prompt: async () => {
      prompts++;
    },
    abort: async () => {},
    dispose() {},
  };
  (agents as unknown as { sessions: Map<string, unknown> }).sessions.set(record.id, session);
  try {
    await agents.prompt(record, '/subagent');
    assert.equal(record.subagentsEnabled, true);
    assert.ok(tools.includes('subagent'));
    await agents.prompt(record, '/subagent off');
    assert.equal(record.subagentsEnabled, false);
    assert.deepEqual(tools, ['read']);
    await agents.prompt(record, '/subagent invalid');
    assert.match(agents.snapshot(record).error!, /Usage:/);
    await agents.prompt(record, '/login');
    assert.match(agents.snapshot(record).error!, /Unsupported web command/);
    assert.equal(prompts, 0);
  } finally {
    await agents.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
