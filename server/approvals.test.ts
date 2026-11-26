import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { Approvals } from './approvals.js';
import { ChatStore } from './store.js';
import { approvedTools, planTool } from './work-tools.js';
import { AgentService } from './agent.js';
import { ActivityLog } from './activity.js';
import { PipelineService } from './pipelines.js';

function fixture(timeout = 10000) {
  const root = mkdtempSync(join(tmpdir(), 'pi-chat-approval-'));
  const store = new ChatStore(join(root, 'data'));
  const record = store.create(root);
  store.update(record.id, { approvalMode: true });
  const audit: boolean[] = [];
  const approvals = new Approvals(
    () => {},
    (_record, _request, approved) => audit.push(approved),
    timeout,
  );
  return {
    root,
    store,
    record,
    audit,
    approvals,
    cleanup: () => {
      approvals.shutdown();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const context = {} as ExtensionToolContext;

async function waitUntil(check: () => boolean) {
  for (let count = 0; count < 200; count++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail('Timed out waiting for local execution state');
}

test('configured test scripts cannot spawn before approval and can be rejected or stopped while waiting', async () => {
  const f = fixture();
  writeFileSync(
    join(f.root, 'package.json'),
    JSON.stringify({
      scripts: { test: `node -e "require('fs').writeFileSync('test-ran.txt','approved')"` },
    }),
  );
  const pipelines = new PipelineService(
    new ActivityLog(join(f.root, 'activity')),
    () => {},
    (record, task) => f.approvals.guard(record, 'configured_test', { command: task.command }),
  );
  try {
    const rejected = pipelines.start(f.record, 'package:test');
    await waitUntil(() => f.approvals.list(f.record.id).length === 1);
    assert.equal(existsSync(join(f.root, 'test-ran.txt')), false);
    f.approvals.decide(f.record.id, f.approvals.list(f.record.id)[0].id, false);
    await assert.rejects(rejected, /rejected/);

    const approved = pipelines.start(f.record, 'package:test');
    await waitUntil(() => f.approvals.list(f.record.id).length === 1);
    f.approvals.decide(f.record.id, f.approvals.list(f.record.id)[0].id, true);
    await approved;
    await waitUntil(() => !pipelines.busy(f.record.id));
    assert.equal(readFileSync(join(f.root, 'test-ran.txt'), 'utf8'), 'approved');
    rmSync(join(f.root, 'test-ran.txt'));

    const stopped = pipelines.start(f.record, 'package:test');
    await waitUntil(() => f.approvals.list(f.record.id).length === 1);
    await pipelines.stop(f.record.id);
    f.approvals.cancel(f.record.id);
    await assert.rejects(stopped, /rejected|cancelled/);
    assert.equal(existsSync(join(f.root, 'test-ran.txt')), false);
  } finally {
    f.approvals.shutdown();
    await pipelines.shutdown();
    f.cleanup();
  }
});

test('writes, edits and shell tools wait for exact one-shot approval; replays and wrong-chat approvals fail', async () => {
  const f = fixture();
  try {
    const tools = approvedTools(f.record, f.approvals);
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'bash',
      'edit',
      'powershell',
      'write',
    ]);
    const write = tools.find((tool) => tool.name === 'write')!;
    const input = { path: 'approved.txt', content: 'original' };
    const pending = write.execute('write-1', input, undefined, undefined, context);
    const request = f.approvals.list(f.record.id)[0];
    input.content = 'mutated while waiting';
    assert.equal(existsSync(join(f.root, 'approved.txt')), false);
    assert.deepEqual(request.input, { path: 'approved.txt', content: 'original' });
    assert.equal(f.approvals.decide('other-chat', request.id, true), false);
    assert.equal(f.approvals.decide(f.record.id, request.id, true), true);
    await pending;
    assert.equal(readFileSync(join(f.root, 'approved.txt'), 'utf8'), 'original');
    assert.equal(f.approvals.decide(f.record.id, request.id, true), false);

    const edit = tools.find((tool) => tool.name === 'edit')!;
    const editing = edit.execute(
      'edit-1',
      { path: 'approved.txt', edits: [{ oldText: 'original', newText: 'edited' }] },
      undefined,
      undefined,
      context,
    );
    assert.equal(readFileSync(join(f.root, 'approved.txt'), 'utf8'), 'original');
    f.approvals.decide(f.record.id, f.approvals.list(f.record.id)[0].id, true);
    await editing;
    assert.equal(readFileSync(join(f.root, 'approved.txt'), 'utf8'), 'edited');

    for (const name of ['bash', 'powershell']) {
      const shell = tools.find((tool) => tool.name === name)!;
      const running = shell.execute(
        name,
        { command: 'echo should-not-run' },
        undefined,
        undefined,
        context,
      );
      assert.equal(f.approvals.list(f.record.id)[0].tool, name);
      f.approvals.decide(f.record.id, f.approvals.list(f.record.id)[0].id, false);
      const result = await running;
      assert.equal(result.isError, true);
      assert.equal(result.terminate, true);
    }
    assert.deepEqual(f.audit, [true, true, false, false]);
  } finally {
    f.cleanup();
  }
});

test('cancellation, expiry, shutdown and failed auditing all fail closed', async (t) => {
  const auditErrors = t.mock.method(console, 'error', () => {});
  const f = fixture(20);
  try {
    const controller = new AbortController();
    const cancelled = assert.rejects(
      f.approvals.guard(f.record, 'write', {}, controller.signal),
      /rejected|cancelled/,
    );
    controller.abort();
    await cancelled;
    assert.equal(f.approvals.list(f.record.id).length, 0);
    const expired = assert.rejects(f.approvals.guard(f.record, 'bash', {}), /expired/);
    await delay(40);
    await expired;
    const stopped = assert.rejects(f.approvals.guard(f.record, 'edit', {}), /rejected/);
    f.approvals.shutdown();
    await stopped;
    await assert.rejects(f.approvals.guard(f.record, 'write', {}), /cancelled/);

    const failedAudit = new Approvals(
      () => {},
      () => {
        throw new Error('test audit failure');
      },
    );
    const failure = assert.rejects(failedAudit.guard(f.record, 'write', {}), /rejected/);
    failedAudit.decide(f.record.id, failedAudit.list(f.record.id)[0].id, true);
    await failure;
    assert.equal(auditErrors.mock.callCount(), 1);
  } finally {
    f.cleanup();
  }
});

test('task plans are explicit persistent public steps and can be read without replacement', async () => {
  const f = fixture();
  try {
    let updates = 0;
    const tool = planTool(f.record, f.store, () => updates++);
    const steps = [{ text: ' Run regression tests ', status: 'running' as const }];
    await tool.execute('plan', { steps }, undefined, undefined, context);
    const result = await tool.execute('read-plan', {}, undefined, undefined, context);
    assert.match(JSON.stringify(result.content), /Run regression tests/);
    assert.equal(updates, 1);
    assert.deepEqual(new ChatStore(f.store.directory).get(f.record.id)?.plan, [
      { text: 'Run regression tests', status: 'running' },
    ]);
    await assert.rejects(
      tool.execute(
        'blank',
        { steps: [{ text: ' ', status: 'pending' }] },
        undefined,
        undefined,
        context,
      ),
      /blank/,
    );
  } finally {
    f.cleanup();
  }
});

test('SDK parent sessions register gated execution overrides rather than unguarded built-ins', async () => {
  const f = fixture();
  const service = new AgentService(f.store);
  try {
    const session = await (
      service as unknown as {
        session: (
          record: typeof f.record,
        ) => Promise<import('@earendil-works/pi-coding-agent').AgentSession>;
      }
    ).session(f.record);
    assert.ok(session.getActiveToolNames().includes('update_plan'));
    assert.equal(session.getActiveToolNames().includes('subagent'), false);
    const write = session.agent.state.tools.find((tool) => tool.name === 'write')!;
    const pending = write.execute('sdk-write', {
      path: 'sdk.txt',
      content: 'approved through SDK',
    });
    await delay(0);
    assert.equal(existsSync(join(f.root, 'sdk.txt')), false);
    const request = service.approvals.list(f.record.id)[0];
    assert.equal(request.tool, 'write');
    service.approvals.decide(f.record.id, request.id, true);
    await pending;
    assert.equal(readFileSync(join(f.root, 'sdk.txt'), 'utf8'), 'approved through SDK');
    const denied = write.execute('sdk-denied', {
      path: 'denied.txt',
      content: 'must not be written',
    });
    await waitUntil(() => service.approvals.list(f.record.id).length === 1);
    service.approvals.decide(f.record.id, service.approvals.list(f.record.id)[0].id, false);
    assert.equal((await denied).isError, true);
    assert.equal(existsSync(join(f.root, 'denied.txt')), false);
    assert.equal(service.snapshot(f.record).queuePaused, true);
    assert.match(service.snapshot(f.record).error ?? '', /rejected/);
  } finally {
    await service.shutdown();
    f.cleanup();
  }
});
