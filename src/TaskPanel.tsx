import { useState } from 'react';
import { api, type Chat, type Snapshot } from './api';

type PlanStep = NonNullable<Chat['plan']>[number];

export default function TaskPanel({
  snapshot,
  onError,
}: {
  snapshot?: Snapshot;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<string[]>([]);
  const chat = snapshot?.chat;
  if (!chat) return null;
  const plan = chat.plan ?? [];
  const approvals = snapshot?.approvals ?? [];

  async function save(steps: PlanStep[]) {
    if (!chat) return;
    setSaving(true);
    try {
      await api(`/chats/${chat.id}`, { method: 'PATCH', body: JSON.stringify({ plan: steps }) });
      setText('');
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function decide(id: string, approved: boolean) {
    if (!chat) return;
    setDeciding((current) => [...current, id]);
    try {
      await api(`/chats/${chat.id}/approvals/${id}`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeciding((current) => current.filter((value) => value !== id));
    }
  }

  return (
    <div className="task-panel">
      {approvals.map((request) => (
        <section
          className="approval-request"
          aria-label={`Approval for ${request.tool}`}
          key={request.id}
        >
          <h3>Approval required · {request.tool}</h3>
          <p>Workspace: {request.cwd}</p>
          <pre>{JSON.stringify(request.input, null, 2)}</pre>
          <p>
            Review the complete proposal. Approval allows this exact action once, not future calls.
            Expires after 10 minutes.
          </p>
          <button
            className="secondary-button"
            disabled={deciding.includes(request.id)}
            onClick={() => void decide(request.id, true)}
          >
            Approve once
          </button>{' '}
          <button
            className="secondary-button"
            disabled={deciding.includes(request.id)}
            onClick={() => void decide(request.id, false)}
          >
            Reject
          </button>
        </section>
      ))}
      <details className="task-plan" open={plan.length > 0 ? true : undefined}>
        <summary>
          Task plan · {plan.filter((step) => step.status === 'done').length}/{plan.length} done
        </summary>
        <p>
          Observable steps and outcomes only — not private model reasoning. Pi can update this
          checklist while working.
        </p>
        <ol>
          {plan.map((step, index) => (
            <li key={index}>
              <span className={`plan-status ${step.status}`}>
                {step.status === 'done'
                  ? '✓ Done'
                  : step.status === 'running'
                    ? '◉ Running'
                    : '○ Pending'}
              </span>
              <span>{step.text}</span>
              <button
                className="secondary-button"
                disabled={!!snapshot?.busy || saving}
                aria-label={`Change status of ${step.text}`}
                onClick={() =>
                  void save(
                    plan.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            status:
                              item.status === 'pending'
                                ? 'running'
                                : item.status === 'running'
                                  ? 'done'
                                  : 'pending',
                          }
                        : item,
                    ),
                  )
                }
              >
                Next status
              </button>
              <button
                className="secondary-button"
                disabled={!!snapshot?.busy || saving}
                aria-label={`Remove step ${step.text}`}
                onClick={() => void save(plan.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void save([...plan, { text: text.trim(), status: 'pending' }]);
          }}
        >
          <input
            aria-label="New plan step"
            placeholder="Add a visible task step"
            value={text}
            maxLength={300}
            onChange={(event) => setText(event.target.value)}
            disabled={!!snapshot?.busy || saving || plan.length >= 30}
            required
          />
          <button
            className="secondary-button"
            disabled={!!snapshot?.busy || saving || plan.length >= 30}
          >
            Add step
          </button>
        </form>
      </details>
    </div>
  );
}
