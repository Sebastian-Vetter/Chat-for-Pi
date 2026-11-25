import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Subagents, RESEARCH_TOOLS } from './subagents.js';
import { ActivityLog } from './activity.js';
import { ChatStore } from './store.js';
import type {
  AgentSession,
  createAgentSession,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';

test('research delegation is opt-in, read-only, observable and disposes children without exposing reasoning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-subagents-'));
  try {
    const store = new ChatStore(dir);
    const record = store.create(process.cwd());
    const activity = new ActivityLog(join(dir, 'activity'));
    let disposed = 0;
    let published = 0;
    let fail = false;
    let wait = false;
    let started: () => void = () => {};
    let finish: () => void = () => {};
    const create = async (options: Parameters<typeof createAgentSession>[0]) => {
      assert.deepEqual(options?.tools, RESEARCH_TOOLS);
      assert.equal(options?.customTools, undefined);
      return {
        session: {
          subscribe() {},
          messages: [],
          async prompt() {
            if (fail) throw new Error('Provider unavailable');
            if (wait)
              await new Promise<void>((resolve) => {
                finish = resolve;
                started();
              });
          },
          async abort() {
            finish();
          },
          getLastAssistantText: () => 'Found src/App.tsx',
          dispose() {
            disposed++;
          },
        } as unknown as AgentSession,
      };
    };
    const agents = new Subagents(
      Promise.resolve({} as ModelRuntime),
      activity,
      () => published++,
      create as typeof createAgentSession,
    );
    const tool = agents.tool(record, () => undefined);
    const execute = () =>
      tool.execute('call', { task: 'Find the entry point' }, undefined, undefined, {} as never);
    await assert.rejects(execute(), /Enable research/);
    store.update(record.id, { subagentsEnabled: true });
    const result = await execute();
    assert.equal(result.content[0].type, 'text');
    assert.equal(activity.list(record.id)[0].status, 'passed');
    assert.match(activity.list(record.id)[0].detail!, /src\/App.tsx/);
    assert.equal(disposed, 1);
    assert.ok(published >= 2);
    fail = true;
    await assert.rejects(execute(), /Provider unavailable/);
    assert.equal(activity.list(record.id)[1].status, 'failed');
    assert.equal(disposed, 2);
    assert.equal(new ChatStore(dir).get(record.id)?.subagentsEnabled, true);
    fail = false;
    wait = true;
    const activeController = new AbortController();
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = tool.execute(
      'active',
      { task: 'In-flight research' },
      activeController.signal,
      undefined,
      {} as never,
    );
    await running;
    activeController.abort();
    await assert.rejects(pending, /stopped/);
    assert.equal(activity.list(record.id)[2].status, 'stopped');
    assert.equal(disposed, 3);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      tool.execute('stop', { task: 'Stop' }, controller.signal, undefined, {} as never),
      /stopped/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
