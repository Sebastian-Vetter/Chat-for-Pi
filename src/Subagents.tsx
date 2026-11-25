import type { Snapshot } from './api';
export default function Subagents({ snapshot }: { snapshot?: Snapshot }) {
  const events = snapshot?.events?.filter((event) => event.label.startsWith('Subagent ·')) ?? [];
  if (!snapshot?.chat.subagentsEnabled && !events.length) return null;
  return (
    <section className="subagents-panel" aria-label="Research subagents">
      <header>
        <strong>Research subagents</strong>
        <span>{snapshot?.chat.subagentsEnabled ? 'Enabled · read-only' : 'Disabled'}</span>
      </header>
      {!events.length && (
        <p>
          Pi can delegate focused research on your next prompt. Each agent uses the selected model
          and additional provider usage. Disable with /subagent off.
        </p>
      )}
      {events.map((event) => (
        <details key={event.id} open={event.status === 'running'}>
          <summary>
            {event.label} — {event.status}
            {event.durationMs !== undefined ? ` · ${(event.durationMs / 1000).toFixed(1)}s` : ''}
          </summary>
          <pre>{event.detail}</pre>
        </details>
      ))}
    </section>
  );
}
