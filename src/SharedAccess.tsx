import { useState } from 'react';
import { api } from './api';

export interface AccessRequest {
  id: string;
  peer: { id: string; name: string };
  createdAt: string;
}
export interface OwnerAccessRequest extends AccessRequest {
  sessionId: string;
  sessionTitle: string;
}
export interface OutgoingAccessRequest {
  id: string;
  ownerId: string;
  ownerName: string;
  sessionId: string;
  title: string;
  state: 'pending' | 'approved' | 'denied' | 'expired' | 'unavailable';
  remoteId?: string;
  error?: string;
}
export function AccessRequests({
  requests,
  changed,
}: {
  requests: OwnerAccessRequest[];
  changed: () => void;
}) {
  return requests.length ? (
    <section className="shared-access-requests" aria-label="Pending access requests">
      <h3>Access requests</h3>
      <p>
        Verify the participant's installation ID before approving. Writers can run tools with this
        machine's permissions.
      </p>
      {requests.map((request) => (
        <AccessRequestRow key={request.id} request={request} changed={changed} />
      ))}
    </section>
  ) : null;
}
function AccessRequestRow({
  request,
  changed,
}: {
  request: OwnerAccessRequest;
  changed: () => void;
}) {
  const [role, setRole] = useState('reader');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  async function decide(approved: boolean) {
    setWorking(true);
    setError('');
    try {
      await api(`/shared/sessions/${request.sessionId}/requests/${request.id}`, {
        method: 'POST',
        body: JSON.stringify({ role: approved ? role : null }),
      });
      changed();
    } catch (error) {
      setError(String(error));
      setWorking(false);
    }
  }
  return (
    <div className="shared-access-request" aria-label={`Access request from ${request.peer.name}`}>
      <strong>{request.peer.name}</strong>
      <span>{request.sessionTitle}</span>
      <code className="shared-id">{request.peer.id}</code>
      <div className="shared-actions">
        <select
          aria-label={`Role for request ${request.peer.name}`}
          value={role}
          disabled={working}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="reader">Reader</option>
          <option value="writer">Writer</option>
        </select>
        <button className="secondary-button" disabled={working} onClick={() => void decide(true)}>
          Accept request
        </button>
        <button className="secondary-button" disabled={working} onClick={() => void decide(false)}>
          Reject request
        </button>
      </div>
      {error && (
        <p className="shared-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
