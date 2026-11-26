import { useState } from 'react';
import { api, type Snapshot } from './api';

export default function TaskPanel({
  snapshot,
  onError,
}: {
  snapshot?: Snapshot;
  onError: (message: string) => void;
}) {
  const [deciding, setDeciding] = useState<string[]>([]);
  const chat = snapshot?.chat;
  if (!chat) return null;
  const approvals = snapshot?.approvals ?? [];
  if (!approvals.length) return null;

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
    </div>
  );
}
