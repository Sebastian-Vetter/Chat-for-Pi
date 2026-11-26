import { Pause, Play, X } from 'lucide-react';
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
  if (!snapshot) return null;
  if (!snapshot.queue?.length)
    return (
      <section className="prompt-queue" aria-label="Prompt queue">
        <h3>Queue</h3>
        <p>Nothing queued. Additional prompts wait here while Pi works.</p>
      </section>
    );
  const base = `/chats/${snapshot.chat.id}/queue`;
  return (
    <section className="prompt-queue" aria-label="Prompt queue">
      <h3>Queue · {snapshot.queue.length} queued</h3>
      <p>{snapshot.queuePaused ? 'Paused' : 'Runs one at a time'}</p>
      <div className="queue-body">
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
                  void api(`${base}/${prompt.id}`, { method: 'DELETE', body: '{}' }).catch((e) =>
                    onError(e.message),
                  )
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
