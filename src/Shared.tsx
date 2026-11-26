import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Circle, Copy, Plus, RefreshCw, Users, X } from 'lucide-react';
import { api, type Chat, type Message } from './api';
import SharedFiles, { sharedRequest } from './SharedFiles';
import MessageView from './MessageView';
import { useConversationScroll } from './useConversationScroll';
import { TypingIndicator, useSharedTyping, type TypingPerson } from './SharedTyping';

export interface Identity {
  id: string;
  name: string;
  publicKey: string;
}
interface Participant extends Identity {
  role: 'reader' | 'writer';
  blocked?: boolean;
}
interface SharedListing {
  owner: Identity;
  owned: { id: string; title: string; enabled: boolean; role: 'owner'; members: Participant[] }[];
  joined: { id: string; title: string; ownerId: string }[];
}
interface Network {
  enabled: boolean;
  address: string;
  port: number;
  addresses: { name: string; address: string }[];
  peers: { id: string; name: string; address: string; sessions: { id: string; title: string }[] }[];
}
const emptyListing: SharedListing = {
  owner: { id: '', name: '', publicKey: '' },
  owned: [],
  joined: [],
};
export function useShared() {
  const [listing, setListing] = useState(emptyListing);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  async function refresh() {
    const next = await api<SharedListing>('/shared/sessions');
    setListing(next);
    setLoaded(true);
  }
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await api<SharedListing>('/shared/sessions');
        if (!cancelled) {
          setListing(next);
          setLoaded(true);
          setError('');
        }
      } catch (error) {
        if (!cancelled) setError(String(error));
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return { listing, refresh, error, loaded };
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog shared-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close?.();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        {close && (
          <button className="icon-button" aria-label={`Close ${title}`} onClick={close}>
            <X size={17} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
export function IdentitySetup({ identity, saved }: { identity: Identity; saved: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal title="Welcome to Chat for Pi">
      <p>
        Choose your display name. This installation has its own permanent identity; your name can be
        changed later in Network.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            await api('/shared/identity', { method: 'PATCH', body: JSON.stringify({ name }) });
            saved();
          } catch (error) {
            setError(String(error));
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Your name
          <input
            autoFocus
            aria-label="Your display name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <small className="shared-id">Installation · {identity.id}</small>
        {error && <p role="alert">{error}</p>}
        <button className="secondary-button" disabled={saving || !name.trim()}>
          Continue
        </button>
      </form>
    </Modal>
  );
}
export function NetworkRing({
  identity,
  changed,
  joined,
}: {
  identity: Identity;
  changed: () => void;
  joined: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState<Network>();
  const [link, setLink] = useState('');
  const [address, setAddress] = useState('');
  const [name, setName] = useState(identity.name);
  useEffect(() => setName(identity.name), [identity.name]);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('join')) {
      setLink(location.href);
      setOpen(true);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false,
      loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await api<Network>('/shared/network');
        if (!cancelled) {
          setNetwork(next);
          setAddress((current) => current || next.addresses[0]?.address || '');
        }
      } catch (error) {
        if (!cancelled) setError(String(error));
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);
  async function perform(action: () => Promise<void>) {
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(String(error));
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <button
        className="icon-button network-ring"
        aria-label="Local network shared sessions"
        title="Shared sessions on your local network"
        onClick={() => {
          setName(identity.name);
          setOpen(true);
        }}
      >
        <Circle size={18} />
      </button>
      {open && (
        <Modal title="Local network" close={() => setOpen(false)}>
          <p>
            Sharing is opt-in and LAN-only. Enabling it announces your name and enabled session
            titles on this LAN. Invitations are required; discovery does not grant access. The
            private application stays local.
          </p>
          <div className="shared-actions">
            <select
              aria-label="LAN interface"
              value={address}
              disabled={network?.enabled || working}
              onChange={(event) => setAddress(event.target.value)}
            >
              {network?.addresses.map((item) => (
                <option value={item.address} key={item.address}>
                  {item.name} · {item.address}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={!network || working || (!network.enabled && !address)}
              onClick={() =>
                void perform(async () => {
                  setNetwork(
                    await api<Network>('/shared/network', {
                      method: 'POST',
                      body: JSON.stringify({ enabled: !network?.enabled, address }),
                    }),
                  );
                })
              }
            >
              {network?.enabled ? 'Disable LAN sharing' : 'Enable LAN sharing'}
            </button>
          </div>
          {!network?.addresses.length && <p>No private LAN IPv4 interface available.</p>}
          <h3>Available shared sessions</h3>
          <div className="network-peers">
            {network?.peers.some((peer) => peer.sessions.length) ? (
              network.peers.flatMap((peer) =>
                peer.sessions.map((session) => (
                  <div key={`${peer.id}:${session.id}`}>
                    <Users size={14} />
                    <span>
                      {session.title}
                      <small>{peer.name} · Invitation required · unverified discovery</small>
                    </span>
                  </div>
                )),
              )
            ) : (
              <p>
                No sessions discovered. Enable LAN sharing on both installations, or paste an
                invitation directly. Multicast may be blocked by your network.
              </p>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const result = await api<{ id: string }>('/shared/join', {
                  method: 'POST',
                  body: JSON.stringify({ link }),
                });
                setLink('');
                changed();
                joined(result.id);
                setOpen(false);
              });
            }}
          >
            <label>
              Invitation link
              <input
                aria-label="Shared invitation link"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <p>
              Joining trusts the certificate pinned in this invitation. Confirm the owner and obtain
              the link through a trusted channel. Writers can run local tools on the owner's
              machine.
            </p>
            <button className="secondary-button" disabled={working || !link}>
              Join shared session
            </button>
          </form>
          <details>
            <summary>Your identity</summary>
            <small className="shared-id">{identity.id}</small>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await api('/shared/identity', {
                    method: 'PATCH',
                    body: JSON.stringify({ name }),
                  });
                  changed();
                });
              }}
            >
              <input
                aria-label="Display name"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <button className="secondary-button" disabled={working}>
                Save name
              </button>
            </form>
          </details>
          {error && (
            <p className="shared-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
export function SharedSidebar({
  listing,
  active,
  remote,
  select,
  selectRemote,
  created,
  changed,
}: {
  listing: SharedListing;
  active: string | null;
  remote: string | null;
  select: (id: string) => void;
  selectRemote: (id: string) => void;
  created: (chat: Chat) => void;
  changed: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [manage, setManage] = useState<string>();
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const owned = listing.owned.find((item) => item.id === manage);
  async function action(fn: () => Promise<void>) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await fn();
      changed();
    } catch (error) {
      setError(String(error));
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <button
        className="browse-pi"
        onClick={() => {
          setError('');
          setCreating(true);
        }}
      >
        <Plus size={14} />
        New shared project
      </button>
      <div className="shared-session-list" aria-label="Shared chats">
        {listing.owned.map((item) => (
          <div className="shared-session-row" key={item.id}>
            <button
              className={active === item.id && !remote ? 'selected' : ''}
              onClick={() => select(item.id)}
            >
              <Users size={14} />
              <span>
                {item.title}
                <small>Owner · {item.enabled ? 'Sharing on' : 'Sharing off'}</small>
              </span>
            </button>
            <button
              className="icon-button"
              aria-label={`Manage shared session ${item.title}`}
              onClick={() => {
                setError('');
                setNotice('');
                setManage(item.id);
              }}
            >
              ···
            </button>
          </div>
        ))}
        {listing.joined.map((item) => (
          <div className="shared-session-row" key={item.id}>
            <button
              className={remote === item.id ? 'selected' : ''}
              onClick={() => selectRemote(item.id)}
            >
              <Users size={14} />
              <span>
                {item.title}
                <small>Joined shared session</small>
              </span>
            </button>
            <button
              className="icon-button"
              aria-label={`Leave shared session ${item.title}`}
              onClick={() => {
                if (
                  window.confirm(
                    'Remove this shared session from this installation? Previously downloaded files are not deleted.',
                  )
                )
                  void action(async () => {
                    await api(`/shared/joined/${item.id}`, { method: 'DELETE', body: '{}' });
                    if (remote === item.id) selectRemote('');
                  });
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {!listing.owned.length && !listing.joined.length && (
          <p>No shared sessions yet. Create a project or join through the network ring.</p>
        )}
      </div>
      {creating && (
        <Modal title="New shared project" close={() => setCreating(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const chat = await api<Chat>('/shared/sessions', {
                  method: 'POST',
                  body: JSON.stringify({ title, folder, trustWriters: trust }),
                });
                created(chat);
                setCreating(false);
                setTitle('');
                setFolder('');
                setTrust(false);
              });
            }}
          >
            <label>
              Session name
              <input
                aria-label="Shared session name"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
            <label>
              Empty project folder
              <input
                aria-label="Empty shared project folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder="/path/to/new-project"
                required
              />
            </label>
            <p>
              Choose an empty folder, including hidden files, or a new folder under an existing
              parent. All project files are shared with authorized participants. The session cannot
              become private later; disabling sharing only closes network access.
            </p>
            <label className="shared-consent">
              <input
                type="checkbox"
                aria-label="Trust shared writers"
                checked={trust}
                onChange={(event) => setTrust(event.target.checked)}
                required
              />
              I trust writers to submit prompts and execute tools with this machine's permissions.
              The project folder is not a sandbox.
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="secondary-button" disabled={!trust || working}>
              Create shared project
            </button>
          </form>
        </Modal>
      )}
      {owned && (
        <Modal title="Shared session access" close={() => setManage(undefined)}>
          <p>
            {owned.title} · Owner: {listing.owner.name}
          </p>
          <button
            className="secondary-button"
            disabled={working}
            onClick={() =>
              void action(async () => {
                await api(`/shared/sessions/${owned.id}/access`, {
                  method: 'PATCH',
                  body: JSON.stringify({ enabled: !owned.enabled }),
                });
              })
            }
          >
            {owned.enabled ? 'Turn sharing off' : 'Turn sharing on'}
          </button>
          <p>
            Turning off revokes links and member tokens. Previously downloaded content cannot be
            recalled. Current work is not stopped. Enable LAN sharing via the ring before copying
            invitations.
          </p>
          <div className="shared-actions">
            {(['reader', 'writer'] as const).map((role) => (
              <button
                className="secondary-button"
                key={role}
                disabled={!owned.enabled || working}
                onClick={() =>
                  void action(async () => {
                    const result = await api<{ link: string }>(
                      `/shared/sessions/${owned.id}/invite`,
                      { method: 'POST', body: JSON.stringify({ role }) },
                    );
                    try {
                      await navigator.clipboard.writeText(result.link);
                      setNotice(
                        `${role} invitation copied. Older invitations for this role have expired.`,
                      );
                    } catch {
                      window.prompt('Copy this invitation link', result.link);
                    }
                  })
                }
              >
                <Copy size={13} />
                Copy {role} link
              </button>
            ))}
          </div>
          <h3>Participants</h3>
          {owned.members.length ? (
            owned.members.map((member) => (
              <label className="shared-member" key={member.id}>
                <span>
                  {member.name}
                  <small className="shared-id">{member.id}</small>
                </span>
                <select
                  aria-label={`Role for ${member.name}`}
                  value={member.blocked ? 'removed' : member.role}
                  disabled={working}
                  onChange={(event) =>
                    void action(async () => {
                      await api(`/shared/sessions/${owned.id}/members/${member.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ role: event.target.value }),
                      });
                    })
                  }
                >
                  <option value="reader">Reader</option>
                  <option value="writer">Writer</option>
                  <option value="removed">Revoked</option>
                </select>
              </label>
            ))
          ) : (
            <p>No participants yet.</p>
          )}
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </>
  );
}
interface RemoteSnapshot {
  historyLimited?: boolean;
  typing?: TypingPerson[];
  id: string;
  title: string;
  owner: Identity;
  role: 'reader' | 'writer';
  messages: Message[];
  queue: { id: string; text: string }[];
  queuePaused: boolean;
  queuesEnabled: boolean;
  busy: boolean;
  error?: string;
}
export function RemoteSharedView({
  id,
  changed,
  roleChanged,
  networkControl,
  sidebarControl,
  identityId,
}: {
  id: string;
  changed: () => void;
  roleChanged: (role: 'reader' | 'writer' | undefined) => void;
  networkControl: React.ReactNode;
  sidebarControl?: React.ReactNode;
  identityId: string;
}) {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>();
  const [draft, setDraft] = useState('');
  const typing = useSharedTyping(id, true, snapshot?.role === 'writer');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = 'auto';
      input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
    }
  }, [draft, snapshot?.role]);
  const [version, setVersion] = useState(0);
  const { viewportRef, contentRef, paused, scrollToLatest } = useConversationScroll(
    id,
    snapshot ? `${snapshot.messages.length}:${snapshot.messages.at(-1)?.text ?? ''}` : undefined,
  );
  useEffect(() => {
    let cancelled = false,
      loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await sharedRequest<RemoteSnapshot>({ id, remote: true }, 'snapshot');
        if (!cancelled) {
          setSnapshot(next);
          roleChanged(next.role);
          setError('');
        }
      } catch (error) {
        if (!cancelled) {
          setError(String(error));
          setSnapshot(undefined);
          roleChanged(undefined);
        }
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, version]);
  async function send() {
    if (!draft.trim() || sending || snapshot?.role !== 'writer') return;
    if (snapshot.busy && !snapshot.queuesEnabled) {
      setError(
        'Prompt queues are disabled. Wait for the current response to finish; your draft is kept.',
      );
      return;
    }
    typing.stop();
    const submitted = draft;
    setSending(true);
    try {
      await sharedRequest({ id, remote: true }, 'message', { text: submitted });
      setDraft((current) => (current === submitted ? '' : current));
      setVersion((value) => value + 1);
    } catch (error) {
      setError(String(error));
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <header className="topbar shared-session-topbar shared-remote-topbar">
        <div className="topbar-left">
          {sidebarControl}
          <Users size={16} aria-hidden="true" />
          <span className="page-title">{snapshot?.title ?? 'Shared session'}</span>
          <span className="subtle-pill">{snapshot?.role ?? 'Connecting'}</span>
        </div>
        <div className="shared-header-actions">
          {networkControl}
          <button
            className="icon-button"
            title="Refresh shared session"
            aria-label="Refresh shared session"
            onClick={() => {
              setVersion((value) => value + 1);
              changed();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      {snapshot && (
        <div className="shared-remote-meta">
          <p className="shared-owner" title={`Owner installation ${snapshot.owner.id}`}>
            Owner · {snapshot.owner.name}
            {snapshot.busy ? ' · Working' : ''}
            {snapshot.queue.length
              ? ` · ${snapshot.queue.length} queued${snapshot.queuePaused ? ' · Paused' : ''}`
              : ''}
          </p>
          {snapshot.historyLimited && (
            <p className="shared-owner">
              LAN view is limited to the latest 100 messages and 20,000 characters per message. Full
              history remains with the owner.
            </p>
          )}
        </div>
      )}
      <div
        ref={viewportRef}
        className="conversation-scroll shared-remote-transcript"
        role="region"
        tabIndex={0}
        aria-label="Shared conversation"
      >
        <div ref={contentRef} className="conversation-content">
          <section className="transcript" aria-label="Shared messages">
            {snapshot?.messages.map((message, index) => (
              <MessageView key={index} message={message} remoteContent />
            ))}
          </section>
        </div>
      </div>
      {paused && (
        <div className="latest-message-bar">
          <button className="secondary-button" onClick={() => scrollToLatest()}>
            Jump to latest
          </button>
        </div>
      )}
      <div className="composer-area shared-remote-footer">
        <TypingIndicator people={snapshot?.typing ?? []} self={identityId} />
        {error && (
          <p className="shared-error" role="alert" tabIndex={0}>
            {error}
          </p>
        )}
        {snapshot?.error && (
          <p className="shared-error" role="status" tabIndex={0}>
            {snapshot.error}
          </p>
        )}
        {snapshot?.role === 'writer' ? (
          <form
            className="composer shared-remote-composer"
            aria-label="Shared message composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={input}
              rows={2}
              aria-label="Message shared session"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                typing.changed(event.target.value);
              }}
              onBlur={typing.stop}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Write to the shared project…"
            />
            <div className="composer-toolbar">
              <span className="shared-composer-hint">
                {snapshot.busy
                  ? snapshot.queuesEnabled
                    ? 'Enter to queue'
                    : 'Wait for the current reply'
                  : 'Enter to send'}{' '}
                · Shift+Enter newline
              </span>
              <button
                className="send-button"
                aria-label="Send to shared session"
                title="Send to shared session"
                disabled={!draft.trim() || sending || (!snapshot.queuesEnabled && snapshot.busy)}
              >
                <ArrowUp size={20} aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <p className="shared-owner shared-reader-note">
            {snapshot
              ? 'Read-only access. Only the owner can change your role.'
              : 'Waiting for an authenticated connection to the owner.'}
          </p>
        )}
        {snapshot?.role === 'writer' && (
          <p className="composer-disclaimer">
            Prompts run on the owner's machine. Existing work is queued when queues are enabled.
          </p>
        )}
      </div>
    </>
  );
}
export { SharedFiles };
