import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { editPlan, PlanEditError } from './plans.js';
import { ChatStore, type PlanStep } from './store.js';
import { planTool } from './work-tools.js';

const plan: PlanStep[] = [
  { text: 'A', status: 'pending' },
  { text: 'Running', status: 'running' },
  { text: 'B', status: 'pending' },
  { text: 'Done', status: 'done' },
  { text: 'C', status: 'pending' },
];

function rejects(body: unknown, busy = false, status = 400) {
  assert.throws(
    () => editPlan(plan, 7, body, busy),
    (error: unknown) => error instanceof PlanEditError && error.status === status,
  );
}

test('pending slots can be reordered in either direction during active work without moving running/done steps', () => {
  const before = structuredClone(plan);
  const up = editPlan(plan, 7, { revision: 7, action: 'move', index: 4, targetIndex: 0 }, true);
  assert.deepEqual(
    up.map((step) => step.text),
    ['C', 'Running', 'A', 'Done', 'B'],
  );
  const down = editPlan(plan, 7, { revision: 7, action: 'move', index: 0, targetIndex: 4 }, true);
  assert.deepEqual(
    down.map((step) => step.text),
    ['B', 'Running', 'C', 'Done', 'A'],
  );
  assert.deepEqual(plan, before);
  for (const next of [up, down]) {
    assert.deepEqual(next[1], plan[1]);
    assert.deepEqual(next[3], plan[3]);
  }
  const added = editPlan(plan, 7, { revision: 7, action: 'add', text: ' New task ' }, true);
  assert.deepEqual(added, [...plan, { text: 'New task', status: 'pending' }]);
});

test('plan mutations reject stale revisions, invalid input and changes to protected steps while busy', () => {
  rejects({ revision: 6, action: 'add', text: 'stale' }, false, 409);
  rejects({ action: 'add', text: 'no revision' });
  rejects({ revision: '7', action: 'add', text: 'string revision' });
  rejects({ revision: 7, action: 'constructor' });
  rejects({ revision: 7, action: 'add', text: ' ' });
  rejects({ revision: 7, action: 'add', text: 'x'.repeat(301) });
  rejects({ revision: 7, action: 'add', text: 'new', status: 'running' });
  rejects({ revision: 7, action: 'move', index: -1, targetIndex: 0 });
  rejects({ revision: 7, action: 'move', index: 0, targetIndex: 1.5 });
  rejects({ revision: 7, action: 'move', index: 0, targetIndex: 100 });
  rejects({ revision: 7, action: 'move', index: 1, targetIndex: 0 }, false, 409);
  rejects({ revision: 7, action: 'move', index: 0, targetIndex: 3 }, false, 409);
  rejects({ revision: 7, action: 'remove', index: 0 }, true, 409);
  rejects({ revision: 7, action: 'status', index: 0, status: 'done' }, true, 409);
  rejects({ revision: 7, action: 'status', index: 0, status: ['done'] });
  assert.equal(
    editPlan(plan, 7, { revision: 7, action: 'status', index: 0, status: 'running' }, false)[0]
      .status,
    'running',
  );
  assert.equal(editPlan(plan, 7, { revision: 7, action: 'remove', index: 0 }, false).length, 4);
  assert.throws(
    () =>
      editPlan(
        Array.from({ length: 30 }, () => plan[0]),
        0,
        { revision: 0, action: 'add', text: 'overflow' },
        true,
      ),
    /30/,
  );
});

test('plan revisions persist and stale model updates cannot overwrite new user tasks or ordering', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-chat-plan-'));
  try {
    const store = new ChatStore(root);
    const record = store.create(root);
    assert.equal(record.planRevision, undefined);
    const tool = planTool(record, store, () => {});
    const context = {} as ExtensionToolContext;
    await tool.execute('initial', { steps: plan }, undefined, undefined, context);
    const read = await tool.execute('read', {}, undefined, undefined, context);
    assert.equal(record.planRevision, 1);
    assert.match(JSON.stringify(read.content), /revision/);
    const reordered = editPlan(
      record.plan!,
      1,
      { revision: 1, action: 'move', index: 4, targetIndex: 0 },
      true,
    );
    store.update(record.id, { plan: reordered });
    await assert.rejects(
      tool.execute('stale', { revision: 1, steps: plan }, undefined, undefined, context),
      /changed/,
    );
    await assert.rejects(
      tool.execute('missing-revision', { steps: plan }, undefined, undefined, context),
      /revision/,
    );
    assert.deepEqual(record.plan, reordered);
    store.update(record.id, { title: 'Metadata does not revise the plan' });
    assert.equal(record.planRevision, 2);
    const appended = editPlan(
      record.plan!,
      2,
      { revision: 2, action: 'add', text: 'User follow-up' },
      true,
    );
    store.update(record.id, { plan: appended });
    await assert.rejects(
      tool.execute(
        'stale-after-add',
        { revision: 2, steps: reordered },
        undefined,
        undefined,
        context,
      ),
      /changed/,
    );
    await tool.execute('fresh', { revision: 3, steps: appended }, undefined, undefined, context);
    const persisted = new ChatStore(root).get(record.id)!;
    assert.equal(persisted.planRevision, 4);
    assert.deepEqual(persisted.plan, appended);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
