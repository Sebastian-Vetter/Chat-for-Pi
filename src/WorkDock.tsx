import { useEffect, useId, useRef, useState } from 'react';
import { ListChecks, ListOrdered, X } from 'lucide-react';
import type { Chat, Snapshot } from './api';
import { PromptQueue } from './SessionStatus';
import TaskPlan from './TaskPlan';

type View = 'plan' | 'queue';

export default function WorkDock({
  snapshot,
  showPlan,
  queuesEnabled,
  onError,
}: {
  snapshot?: Snapshot;
  showPlan: boolean;
  queuesEnabled: boolean;
  onError: (message: string) => void;
}) {
  const [requestedView, setView] = useState<View>();
  const view =
    requestedView === 'plan'
      ? showPlan
        ? 'plan'
        : undefined
      : queuesEnabled
        ? requestedView
        : undefined;
  useEffect(() => {
    if (!view) setView(undefined);
  }, [view]);
  const [confirmed, setConfirmed] = useState<Chat>();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const planButton = useRef<HTMLButtonElement>(null);
  const queueButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const incoming = snapshot?.chat;
  const chat =
    confirmed &&
    confirmed.id === incoming?.id &&
    (confirmed.planRevision ?? 0) > (incoming.planRevision ?? 0)
      ? confirmed
      : incoming;
  const steps = chat?.plan ?? [];
  const queue = snapshot?.queue ?? [];
  const busy =
    !!snapshot?.busy ||
    !!snapshot?.approvals?.some((request) => request.tool === 'configured_test') ||
    !!snapshot?.events?.some((event) => event.type === 'test' && event.status === 'running');

  useEffect(() => {
    if (!view) return;
    panel.current?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setView(undefined);
    }
    function escape(event: KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest('[role="dialog"]'))
      )
        return;
      event.preventDefault();
      setView(undefined);
      (view === 'plan' ? planButton : queueButton).current?.focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [view]);

  if (!chat) return null;
  function close() {
    setView(undefined);
    (view === 'plan' ? planButton : queueButton).current?.focus({ preventScroll: true });
  }

  return (
    <div
      className="work-dock"
      hidden={!showPlan && !queuesEnabled}
      ref={root}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setView(undefined);
      }}
    >
      <div className="work-summary" aria-label="Plan and queue">
        {showPlan && (
          <button
            ref={planButton}
            type="button"
            aria-label={view === 'plan' ? 'Hide task plan' : 'Show task plan'}
            aria-expanded={view === 'plan'}
            aria-controls={`${id}-plan`}
            onClick={() => setView((current) => (current === 'plan' ? undefined : 'plan'))}
          >
            <ListChecks size={14} aria-hidden="true" />
            <span>Task plan</span>
            <span className="work-count">
              {steps.filter((step) => step.status === 'done').length}/{steps.length}
            </span>
          </button>
        )}
        {queuesEnabled && (
          <button
            ref={queueButton}
            type="button"
            aria-label={view === 'queue' ? 'Hide prompt queue' : 'Show prompt queue'}
            aria-expanded={view === 'queue'}
            aria-controls={`${id}-queue`}
            onClick={() => setView((current) => (current === 'queue' ? undefined : 'queue'))}
          >
            <ListOrdered size={14} aria-hidden="true" />
            <span>Queue</span>
            <span className="work-count">{queue.length} queued</span>
            {queue.length > 0 && snapshot?.queuePaused && (
              <span className="work-paused">Paused</span>
            )}
          </button>
        )}
      </div>
      <div
        className="work-popover"
        ref={panel}
        role="region"
        aria-label="Work details"
        tabIndex={-1}
        hidden={!view}
      >
        <button
          className="icon-button work-close"
          type="button"
          aria-label="Close work details"
          title="Close details (Escape)"
          onClick={close}
        >
          <X size={15} aria-hidden="true" />
        </button>
        <div id={`${id}-plan`} hidden={view !== 'plan'}>
          <TaskPlan
            key={chat.id}
            chat={chat}
            busy={busy}
            onError={onError}
            onChange={(next) =>
              setConfirmed((previous) =>
                previous?.id === next.id && (previous.planRevision ?? 0) > (next.planRevision ?? 0)
                  ? previous
                  : next,
              )
            }
          />
        </div>
        <div id={`${id}-queue`} hidden={view !== 'queue'}>
          <PromptQueue snapshot={snapshot} onError={onError} />
        </div>
      </div>
    </div>
  );
}
