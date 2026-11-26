import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { api, type Chat, type Snapshot } from './api';
import type { PlanEdit } from '../server/plans';

interface DraggedStep {
  index: number;
  revision: number;
}

export default function TaskPlan({
  chat,
  busy,
  onError,
}: {
  chat: Chat;
  busy: boolean;
  onError: (message: string) => void;
}) {
  const [confirmed, setConfirmed] = useState<Chat>();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragged, setDragged] = useState<DraggedStep>();
  const [dropTarget, setDropTarget] = useState<number>();
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const restoreFocus = useRef<{ index: number; revision: number; control: string } | undefined>(
    undefined,
  );
  const current =
    confirmed && (confirmed.planRevision ?? 0) > (chat.planRevision ?? 0) ? confirmed : chat;
  const revision = current.planRevision ?? 0;
  const plan = current.plan ?? [];
  const pending = plan.flatMap((step, index) => (step.status === 'pending' ? [index] : []));
  const occurrences = new Map<string, number>();

  useEffect(() => {
    if (dragged && dragged.revision !== revision) {
      setDragged(undefined);
      setDropTarget(undefined);
      setNotice('The task plan changed while dragging. Review the latest plan and try again.');
    }
  }, [revision, dragged]);

  useLayoutEffect(() => {
    const target = restoreFocus.current;
    if (!target || revision < target.revision) return;
    restoreFocus.current = undefined;
    if (revision !== target.revision) return;
    const row = list.current?.querySelector(`[data-plan-index="${target.index}"]`);
    const button =
      row?.querySelector<HTMLButtonElement>(`[data-control="${target.control}"]:not(:disabled)`) ??
      row?.querySelector<HTMLButtonElement>('[data-control="drag"]');
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest' });
  }, [revision, saving]);

  function accept(next: Chat) {
    setConfirmed((previous) =>
      previous && (previous.planRevision ?? 0) > (next.planRevision ?? 0) ? previous : next,
    );
  }

  async function edit(operation: PlanEdit, focusControl?: string) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setNotice('');
    setDragged(undefined);
    setDropTarget(undefined);
    const submittedText = text;
    try {
      const next = await api<Chat>(`/chats/${chat.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ ...operation, revision }),
      });
      if (operation.action === 'move' && focusControl)
        restoreFocus.current = {
          index: operation.targetIndex,
          revision: next.planRevision ?? 0,
          control: focusControl,
        };
      accept(next);
      if (operation.action === 'add') setText((value) => (value === submittedText ? '' : value));
      setNotice(
        operation.action === 'move'
          ? 'Pending step moved. Running and completed steps stayed in place.'
          : 'Task plan updated.',
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      // Never retry a stale mutation automatically: refresh, then let the reader decide.
      try {
        accept((await api<Snapshot>(`/chats/${chat.id}`)).chat);
      } catch {
        /* The connection may also be unavailable. */
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <details className="task-plan" aria-busy={saving} open={plan.length > 0 ? true : undefined}>
      <summary>
        Task plan · {plan.filter((step) => step.status === 'done').length}/{plan.length} done
      </summary>
      <p>
        Observable steps and outcomes only — not private model reasoning. Add steps or reorder
        pending steps even while Pi works. Running and completed steps stay in place. This checklist
        does not start or queue prompts.
      </p>
      <ol ref={list} aria-label="Task plan steps">
        {plan.map((step, index) => {
          const identity = JSON.stringify([step.status, step.text]);
          const occurrence = occurrences.get(identity) ?? 0;
          occurrences.set(identity, occurrence + 1);
          const position = pending.indexOf(index);
          const canMove = step.status === 'pending' && !saving;
          return (
            <li
              key={`${identity}:${occurrence}`}
              data-plan-index={index}
              className={dropTarget === index ? 'plan-drop-target' : undefined}
              onDragOver={(event) => {
                if (
                  !canMove ||
                  !dragged ||
                  dragged.index === index ||
                  dragged.revision !== revision
                )
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(index);
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setDropTarget((value) => (value === index ? undefined : value));
              }}
              onDrop={(event) => {
                if (
                  !canMove ||
                  !dragged ||
                  dragged.index === index ||
                  dragged.revision !== revision
                )
                  return;
                event.preventDefault();
                void edit({ action: 'move', index: dragged.index, targetIndex: index }, 'drag');
              }}
            >
              {step.status === 'pending' && (
                <button
                  type="button"
                  className="secondary-button plan-drag-handle"
                  data-control="drag"
                  draggable={canMove}
                  disabled={saving}
                  aria-label={`Drag pending step ${step.text}`}
                  title="Drag to another pending step, or use the up/down buttons"
                  onDragStart={(event) => {
                    if (!canMove) {
                      event.preventDefault();
                      return;
                    }
                    setDragged({ index, revision });
                    setDropTarget(undefined);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(
                      'application/x-pi-plan-step',
                      JSON.stringify({ chatId: chat.id, index, revision }),
                    );
                  }}
                  onDragEnd={() => {
                    setDragged(undefined);
                    setDropTarget(undefined);
                  }}
                >
                  <GripVertical size={14} />
                </button>
              )}
              <span className={`plan-status ${step.status}`}>
                {step.status === 'done'
                  ? '✓ Done'
                  : step.status === 'running'
                    ? '◉ Running'
                    : '○ Pending'}
              </span>
              <span className="plan-step-text">{step.text}</span>
              {step.status === 'pending' && (
                <div className="plan-move-controls">
                  <button
                    type="button"
                    className="secondary-button"
                    data-control="up"
                    disabled={!canMove || position <= 0}
                    aria-label={`Move step up: ${step.text}`}
                    onClick={() =>
                      void edit({ action: 'move', index, targetIndex: pending[position - 1] }, 'up')
                    }
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-control="down"
                    disabled={!canMove || position === pending.length - 1}
                    aria-label={`Move step down: ${step.text}`}
                    onClick={() =>
                      void edit(
                        { action: 'move', index, targetIndex: pending[position + 1] },
                        'down',
                      )
                    }
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy || saving}
                aria-label={`Change status of ${step.text}`}
                onClick={() =>
                  void edit({
                    action: 'status',
                    index,
                    status:
                      step.status === 'pending'
                        ? 'running'
                        : step.status === 'running'
                          ? 'done'
                          : 'pending',
                  })
                }
              >
                Next status
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || saving}
                aria-label={`Remove step ${step.text}`}
                onClick={() => void edit({ action: 'remove', index })}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void edit({ action: 'add', text: text.trim() });
        }}
      >
        <input
          aria-label="New plan step"
          placeholder="Add a visible task step"
          value={text}
          maxLength={300}
          onChange={(event) => setText(event.target.value)}
          disabled={saving || plan.length >= 30}
          required
        />
        <button className="secondary-button" disabled={saving || plan.length >= 30}>
          Add step
        </button>
      </form>
      <div className="plan-edit-notice" role="status" aria-live="polite">
        {notice}
      </div>
    </details>
  );
}
