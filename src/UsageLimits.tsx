import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { UsageLimits as Limits, UsageProvider, UsageWindow } from '../server/usage-limits';

function WindowUsage({ name, value }: { name: string; value?: UsageWindow }) {
  return (
    <section className="usage-window" aria-label={name}>
      <h3>{name}</h3>
      {value ? (
        <>
          <strong>{Number((100 - value.usedPercent).toFixed(1))}% remaining</strong>
          <progress aria-label={`${name} used`} max={100} value={value.usedPercent} />
          <p>
            {value.usedPercent}% used ·{' '}
            {value.resetsAt ? (
              <>
                Resets{' '}
                <time dateTime={value.resetsAt}>{new Date(value.resetsAt).toLocaleString()}</time>
              </>
            ) : (
              'Reset time not reported'
            )}
          </p>
        </>
      ) : (
        <p>Not reported by the provider — no estimate available.</p>
      )}
    </section>
  );
}

export default function UsageLimits({
  initialProvider,
  close,
}: {
  initialProvider: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<UsageProvider>(
    initialProvider === 'anthropic' ? 'anthropic' : 'openai-codex',
  );
  const [limits, setLimits] = useState<Limits>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLimits(undefined);
    setError('');
    api<Limits>('/usage-limits/check', {
      method: 'POST',
      body: JSON.stringify({ provider }),
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setLimits(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider, refresh]);

  return (
    <dialog
      ref={dialog}
      className="workspace-dialog productivity-dialog"
      aria-label="Subscription usage limits"
      onCancel={close}
    >
      <div className="dialog-heading">
        <h2>Usage limits</h2>
        <button className="secondary-button" onClick={close}>
          Close
        </button>
      </div>
      <p>
        Account-wide subscription allowances reported by your provider, including usage outside this
        chat. These are not chat context tokens or estimated API costs.
      </p>
      <label>
        Subscription provider{' '}
        <select
          aria-label="Subscription provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value as UsageProvider)}
        >
          <option value="openai-codex">OpenAI Codex / ChatGPT</option>
          <option value="anthropic">Anthropic / Claude</option>
        </select>
      </label>
      {loading ? (
        <p role="status">Checking provider limits…</p>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {limits?.message && <p role="status">{limits.message}</p>}
          <WindowUsage name="5-hour limit" value={limits?.fiveHour} />
          <WindowUsage name="Weekly limit" value={limits?.weekly} />
          {limits && (
            <p>
              Last checked:{' '}
              <time dateTime={limits.checkedAt}>{new Date(limits.checkedAt).toLocaleString()}</time>
            </p>
          )}
        </>
      )}
      <button
        className="secondary-button"
        disabled={loading}
        onClick={() => setRefresh((value) => value + 1)}
      >
        Refresh limits
      </button>
      <p>
        Results are cached for one minute. Requests use your existing Pi OAuth login on the server;
        credentials never reach this page. No model prompt is sent. Other providers and API-key
        accounts may not expose these windows.
      </p>
      <a
        href={
          provider === 'anthropic'
            ? 'https://claude.ai/settings/usage'
            : 'https://chatgpt.com/codex/settings/usage'
        }
        target="_blank"
        rel="noreferrer"
      >
        Open provider usage page
      </a>
    </dialog>
  );
}
