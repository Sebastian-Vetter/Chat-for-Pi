import { useId, useState } from 'react';
import { ChevronDown, ListOrdered, Pause, Play, X } from 'lucide-react';
import { api, type Snapshot } from './api';
export function ContextMeter({ snapshot }: { snapshot?: Snapshot }) {
  const context = snapshot?.contextUsage;
  const format = (n: number) =>
    new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return (
    <div
      className="context-meter"
      title={
        context
          ? `${context.tokens?.toLocaleString() ?? 'Unknown'} / ${context.contextWindow.toLocaleString()} tokens. Pi SDK estimate, not an exact billing count.${snapshot?.contextStale ? ' Saved from the last run.' : ''}`
          : 'The context estimate becomes available when this conversation runs in Pi.'
      }
    >
      <span>
        Context{' '}
        {context
          ? `${context.tokens === null ? '?' : format(context.tokens)} / ${format(context.contextWindow)}`
          : '—'}
      </span>
      <div
        role="progressbar"
        aria-label="Estimated context window usage"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(context?.percent != null
          ? { 'aria-valuenow': Math.round(Math.min(context.percent, 100)) }
          : {})}
      >
        <i
          className={(context?.percent ?? 0) > 80 ? 'context-high' : ''}
          style={{ width: `${Math.min(context?.percent ?? 0, 100)}%` }}
        />
      </div>
      <small>
        {context?.percent == null
          ? 'Estimate unavailable'
          : `${context.percent.toFixed(1)}% · ${snapshot?.contextStale ? 'last estimate' : 'estimated'}`}
      </small>
    </div>
  );
}
export function PromptQueue({
  snapshot,
  onError,
}: {
  snapshot?: Snapshot;
  onError: (error: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pi-chat-queue-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const bodyId = useId();
  if (!snapshot?.queue?.length) return null;
  const base = `/chats/${snapshot.chat.id}/queue`;
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('pi-chat-queue-collapsed', String(next));
    } catch {
      /* The toggle still works if browser storage is unavailable. */
    }
  }
  return (
    <div className="queue-dock">
      <section className="prompt-queue" aria-label="Prompt queue">
        <button
          className="queue-summary"
          aria-label={collapsed ? 'Show prompt queue' : 'Hide prompt queue'}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : bodyId}
          onClick={toggle}
        >
          <ListOrdered size={14} />
          <strong>{snapshot.queue.length} queued</strong>
          <span className="queue-state">
            {snapshot.queuePaused ? 'Paused' : 'Runs one at a time'}
          </span>
          <span className="queue-toggle-label">{collapsed ? 'Show' : 'Hide'}</span>
          <ChevronDown size={13} />
        </button>
        {!collapsed && (
          <div className="queue-body" id={bodyId}>
            <div className="queue-controls">
              <button
                onClick={() =>
                  void api(base, {
                    method: 'PATCH',
                    body: JSON.stringify({ paused: !snapshot.queuePaused }),
                  }).catch((e) => onError(e.message))
                }
              >
                {snapshot.queuePaused ? <Play size={12} /> : <Pause size={12} />}
                {snapshot.queuePaused ? 'Resume queue' : 'Pause queue'}
              </button>
            </div>
            <ol>
              {snapshot.queue.map((prompt) => (
                <li key={prompt.id}>
                  <span title={prompt.text}>{prompt.text}</span>
                  <button
                    className="icon-button"
                    aria-label={`Remove queued prompt ${prompt.text.slice(0, 30)}`}
                    onClick={() =>
                      void api(`${base}/${prompt.id}`, { method: 'DELETE', body: '{}' }).catch(
                        (e) => onError(e.message),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
