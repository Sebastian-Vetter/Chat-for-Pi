import type { PlanStep } from './store.js';

export type PlanEdit =
  | { action: 'add'; text: string }
  | { action: 'move'; index: number; targetIndex: number }
  | { action: 'status'; index: number; status: PlanStep['status'] }
  | { action: 'remove'; index: number };

export class PlanEditError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function assertPlanRevision(current: number, expected: unknown) {
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0)
    throw new PlanEditError('A valid plan revision is required');
  if (current !== expected)
    throw new PlanEditError('The task plan changed. Review the latest plan and try again.', 409);
}

/** Index-based operations are safe only against the exact revision the reader saw. */
export function editPlan(
  plan: readonly PlanStep[],
  revision: number,
  body: unknown,
  busy: boolean,
): PlanStep[] {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new PlanEditError('Invalid plan operation');
  const request = body as Record<string, unknown>;
  assertPlanRevision(revision, request.revision);
  const fields: Record<string, string[]> = {
    add: ['revision', 'action', 'text'],
    move: ['revision', 'action', 'index', 'targetIndex'],
    status: ['revision', 'action', 'index', 'status'],
    remove: ['revision', 'action', 'index'],
  };
  const action = request.action;
  if (
    typeof action !== 'string' ||
    !Object.hasOwn(fields, action) ||
    Object.keys(request).some((key) => !fields[action].includes(key))
  )
    throw new PlanEditError('Invalid plan operation');
  const next = plan.map((step) => ({ ...step }));
  if (action === 'add') {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 300)
      throw new PlanEditError('Plan steps must contain 1–300 characters');
    if (next.length >= 30) throw new PlanEditError('At most 30 plan steps are allowed');
    next.push({ text: request.text.trim(), status: 'pending' });
    return next;
  }

  const index = request.index;
  if (typeof index !== 'number' || !Number.isInteger(index) || !next[index])
    throw new PlanEditError('Invalid plan step');
  if (action === 'move') {
    const target = request.targetIndex;
    if (typeof target !== 'number' || !Number.isInteger(target) || !next[target])
      throw new PlanEditError('Invalid target step');
    if (next[index].status !== 'pending' || next[target].status !== 'pending')
      throw new PlanEditError('Only pending steps can be reordered', 409);
    // Reorder only the pending slots. Running/done steps stay at their exact indices.
    const slots = next.flatMap((step, i) => (step.status === 'pending' ? [i] : []));
    const pending = slots.map((i) => next[i]);
    const [moved] = pending.splice(slots.indexOf(index), 1);
    pending.splice(slots.indexOf(target), 0, moved);
    slots.forEach((slot, i) => {
      next[slot] = pending[i];
    });
    return next;
  }

  if (busy)
    throw new PlanEditError('Stop active work before changing statuses or removing steps', 409);
  if (action === 'remove') next.splice(index, 1);
  else {
    if (
      typeof request.status !== 'string' ||
      !['pending', 'running', 'done'].includes(request.status)
    )
      throw new PlanEditError('Invalid plan status');
    next[index].status = request.status as PlanStep['status'];
  }
  return next;
}
