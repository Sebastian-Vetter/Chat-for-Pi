import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Code2,
  Folder,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  Plus,
  Settings,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { api, type Chat, type Config, type Snapshot } from './api';
import MessageView from './MessageView';
import WorkspaceDialog from './WorkspaceDialog';
import Welcome from './Welcome';
import SessionList, { useSessionList } from './SessionList';
import { useConversationScroll } from './useConversationScroll';
import InstructionFiles from './Instructions';
import Inspector from './Inspector';
import SettingsDialog, { readPreferences, playFinishSound, unlockSound } from './Preferences';
import PiSessionBrowser from './PiSessions';
import { ContextMeter, PromptQueue } from './SessionStatus';
import ThinkingPanel from './ThinkingPanel';
import Commands from './Commands';
import Subagents from './Subagents';
import Updates from './Updates';
import './commands.css';
import { version as appVersion } from '../package.json';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export default function App() {
  const [config, setConfig] = useState<Config>();
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState<string | null>(() => localStorage.getItem('pi-chat-active'));
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState('');
  const sessionList = useSessionList();
  const [model, setModel] = useState('');
  const [cwd, setCwd] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [piSessionsOpen, setPiSessionsOpen] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const [soundNotice, setSoundNotice] = useState('');
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [runningChats, setRunningChats] = useState<Record<string, boolean>>({});
  const runningRef = useRef<Record<string, boolean>>({});
  const drafts = useRef<Record<string, string>>({});
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 760);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(!!active);
  const { viewportRef, contentRef, scrollToLatest } = useConversationScroll(active);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const busy = !!snapshot?.busy || sending;
  async function refreshChats() {
    const list = await api<Chat[]>('/chats');
    setChats(list);
    return list;
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Config>('/config'), api<Chat[]>('/chats')])
      .then(([settings, list]) => {
        if (cancelled) return;
        setConfig(settings);
        setCwd(settings.defaultCwd);
        setChats(list);
        setActive((current) => (current && list.some((c) => c.id === current) ? current : null));
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'initial') {
        const states: Record<string, boolean> = {};
        data.chats.forEach((chat: { id: string; busy: boolean }) => {
          states[chat.id] = chat.busy;
        });
        runningRef.current = states;
        setRunningChats(states);
        return;
      }
      const chat = data.chat as { id: string; busy: boolean; error?: string };
      const wasRunning = runningRef.current[chat.id];
      runningRef.current = { ...runningRef.current, [chat.id]: chat.busy };
      setRunningChats(runningRef.current);
      if (wasRunning && !chat.busy && !chat.error && preferencesRef.current.finishSound)
        void playFinishSound(preferencesRef.current).catch(() =>
          setSoundNotice(
            'Your response is finished, but the browser could not play the chime. Open audio settings and click Preview sound to allow playback.',
          ),
        );
    };
    window.addEventListener('pointerdown', unlockSound, { once: true });
    window.addEventListener('keydown', unlockSound, { once: true });
    return () => {
      source.close();
      window.removeEventListener('pointerdown', unlockSound);
      window.removeEventListener('keydown', unlockSound);
    };
  }, []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || document.querySelector('dialog[open]')) return;
      if (event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if (event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setInspectorOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    setSnapshot(undefined);
    setConnected(false);
    setLoading(!!active);
    if (!active) {
      localStorage.removeItem('pi-chat-active');
      return;
    }
    localStorage.setItem('pi-chat-active', active);
    const source = new EventSource(`/api/chats/${active}/events`);
    source.onopen = () => setConnected(true);
    source.onmessage = (event) => {
      const next: Snapshot = JSON.parse(event.data);
      setSnapshot(next);
      setLoading(false);
      setChats((current) =>
        [next.chat, ...current.filter((c) => c.id !== next.chat.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
    };
    source.onerror = () => {
      setConnected(false);
    };
    return () => source.close();
  }, [active]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
    }
  }, [draft]);
  function selectChat(id: string | null) {
    scrollToLatest();
    drafts.current[active ?? 'new'] = draft;
    setActive(id);
    setDraft(drafts.current[id ?? 'new'] ?? '');
    setModel('');
  }
  function newChat() {
    selectChat(null);
    setDraft('');
    setError('');
    setLoading(false);
    if (window.innerWidth <= 760) setSidebar(false);
    textarea.current?.focus();
  }
  function stopResponse() {
    if (!active) return;
    void api(`/chats/${active}/stop`, { method: 'POST', body: '{}' }).catch((error) =>
      setError(errorText(error)),
    );
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || submitting.current) return;
    const command = draft.trim();
    const localCommands: Record<string, () => void> = {
      '/help': () => setCommandsOpen(true),
      '/new': newChat,
      '/settings': () => setSettingsOpen(true),
      '/resume': () => setPiSessionsOpen(true),
      '/diff': () => setInspectorOpen(true),
      '/stop': stopResponse,
    };
    if (Object.hasOwn(localCommands, command)) {
      setDraft('');
      localCommands[command]();
      return;
    }
    if (!config || loading || (!!active && !connected)) return;
    submitting.current = true;
    setSending(true);
    setError('');
    scrollToLatest();
    const text = draft;
    try {
      let id = active;
      if (!id) {
        const chat = await api<Chat>('/chats', { method: 'POST', body: JSON.stringify({ cwd }) });
        id = chat.id;
        setActive(id);
      }
      await api(`/chats/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
          enqueue: !!snapshot?.busy || !!snapshot?.queue?.length,
          ...(model ? { model } : {}),
        }),
      });
      setDraft('');
      await refreshChats();
    } catch (e) {
      setError(errorText(e));
    } finally {
      submitting.current = false;
      setSending(false);
      textarea.current?.focus();
    }
  }
  async function rename(chat: Chat) {
    const title = window.prompt('Rename chat', chat.title);
    if (!title?.trim()) return;
    try {
      await api(`/chats/${chat.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      await refreshChats();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function archive(chat: Chat) {
    try {
      await api(`/chats/${chat.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !chat.archived }),
      });
      if (!chat.archived && active === chat.id) newChat();
      await refreshChats();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function remove(chat: Chat) {
    if (
      !window.confirm(
        `Delete “${chat.title}”? This removes its local conversation history, not workspace files.`,
      )
    )
      return;
    try {
      await api(`/chats/${chat.id}`, { method: 'DELETE', body: '{}' });
      if (active === chat.id) newChat();
      await refreshChats();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const currentChat = chats.find((chat) => chat.id === active);
  const messages = snapshot?.messages ?? [];
  const selectedModel = model || snapshot?.model || '';
  const runningCount = Object.values(runningChats).filter(Boolean).length;
  const latestCommand = snapshot?.events?.findLast(
    (event) => event.label.startsWith('/') && event.status === 'passed',
  );
  return (
    <div className="app-shell">
      {sidebar && (
        <>
          <button
            className="sidebar-scrim"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          />
          <aside className="sidebar">
            <div className="brand-row">
              <a
                className="brand"
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  newChat();
                }}
              >
                <span className="brand-mark">π</span>Chat<span className="brand-badge">for Pi</span>
              </a>
              <button
                className="icon-button"
                aria-label="Close sidebar"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
            <button className="new-chat" onClick={newChat}>
              <Plus size={18} />
              New chat<span>{mac ? '⌘ K' : 'Ctrl K'}</span>
            </button>
            <button className="browse-pi" onClick={() => setPiSessionsOpen(true)}>
              <Terminal size={14} />
              Browse existing Pi sessions
            </button>
            <SessionList
              chats={chats}
              active={active}
              running={runningChats}
              view={sessionList}
              select={(id) => {
                selectChat(id);
                setError('');
                if (window.innerWidth <= 760) setSidebar(false);
              }}
              archive={archive}
              rename={rename}
              remove={remove}
            />
            <InstructionFiles chatId={active} />
            <div className="sidebar-footer">
              <span className="local-dot" />
              <div>
                <strong>Your local workspace</strong>
                <small>
                  {runningCount ? `${runningCount} sessions running` : 'Powered by Pi coding agent'}
                </small>
                <button
                  className="version-label"
                  title="Version and settings"
                  onClick={() => setSettingsOpen(true)}
                >
                  v{appVersion}
                </button>
              </div>
              <button
                className="icon-button sidebar-settings"
                aria-label="Open settings"
                title={mac ? 'Settings (⌘ ,)' : 'Settings (Ctrl ,)'}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={16} />
              </button>
            </div>
          </aside>
        </>
      )}
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebar && (
              <button
                className="icon-button"
                aria-label="Open sidebar"
                onClick={() => setSidebar(true)}
              >
                <Menu size={20} />
              </button>
            )}
            <span className="page-title">{currentChat?.title ?? 'New conversation'}</span>
            <span className="subtle-pill">Pi agent</span>
          </div>
          <button
            className="workspace-button"
            onClick={() => setWorkspaceOpen(true)}
            title={currentChat?.cwd ?? cwd}
          >
            <Folder size={14} />
            <span>
              {(currentChat?.cwd ?? cwd).split('/').filter(Boolean).at(-1) || 'Workspace'}
            </span>
            <ChevronDown size={13} />
          </button>
          <button
            className={`workspace-tools-button ${inspectorOpen ? 'selected' : ''}`}
            aria-label="Toggle workspace tools"
            aria-expanded={inspectorOpen}
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            <Code2 size={16} />
            <span>Tools</span>
          </button>
        </header>
        <Updates
          open={updatesOpen}
          show={() => setUpdatesOpen(true)}
          close={() => setUpdatesOpen(false)}
        />
        <PromptQueue snapshot={snapshot} onError={setError} />
        <div
          className="conversation-scroll"
          ref={viewportRef}
          role="region"
          aria-label="Conversation"
          tabIndex={0}
        >
          <div className="conversation-content" ref={contentRef}>
            {!messages.length && !loading && !busy ? (
              <Welcome
                cwd={currentChat?.cwd ?? cwd}
                choosePrompt={(text) => {
                  setDraft(text);
                  textarea.current?.focus();
                }}
                openWorkspace={() => setWorkspaceOpen(true)}
              />
            ) : (
              <section className="transcript" aria-label="Chat messages">
                {loading && (
                  <div className="status-line">
                    <LoaderCircle size={16} className="spin" />
                    Loading conversation…
                  </div>
                )}
                {messages.map((message, index) => (
                  <MessageView key={index} message={message} />
                ))}
                <ThinkingPanel snapshot={snapshot} />
              </section>
            )}
            {latestCommand && (
              <div className="web-command-result" role="status" key={latestCommand.id}>
                <strong>{latestCommand.label}</strong>
                <p>{latestCommand.detail}</p>
              </div>
            )}
            <Subagents snapshot={snapshot} />
          </div>
        </div>
        <div className="composer-area">
          {(error || snapshot?.error) && (
            <div className="error-banner" role="alert">
              {error || snapshot?.error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => {
                  setError('');
                  setSnapshot((s) => (s ? { ...s, error: undefined } : s));
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {active && !connected && (
            <div className="connection-notice" role="status">
              Connecting to your session… If the server stopped, restart it with npm run dev.
            </div>
          )}
          {soundNotice && (
            <div className="sound-notice" role="status">
              <span>{soundNotice}</span>
              <button onClick={() => setSettingsOpen(true)}>Audio settings</button>
              <button
                className="icon-button"
                aria-label="Dismiss audio notice"
                onClick={() => setSoundNotice('')}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <form
            className={`composer ${busy ? 'composer-working' : ''}`}
            aria-label="Message composer"
            aria-busy={busy}
            onSubmit={(e) => void send(e)}
          >
            <span className="sr-only" role="status">
              {busy ? 'Pi is working.' : ''}
            </span>
            <textarea
              ref={textarea}
              aria-label="Message Pi"
              placeholder={
                snapshot?.busy
                  ? 'Write your next prompt — it will be queued…'
                  : 'Ask Pi anything, or describe what you want to build…'
              }
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="model-picker">
                <Sparkles size={14} />
                <select
                  aria-label="Model"
                  value={selectedModel}
                  disabled={busy || !config}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Pi default model</option>
                  {config?.models.map((m) => (
                    <option value={m.key} key={m.key}>
                      {m.name} · {m.provider}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </div>
              <div className="composer-right">
                <span className="enter-hint">
                  {snapshot?.busy ? '↵ to queue' : '↵ to send'} · ⇧ ↵ newline
                </span>
                {busy && !!draft.trim() && (
                  <button
                    type="submit"
                    className="queue-send"
                    aria-label="Queue prompt"
                    disabled={sending || !connected}
                  >
                    Queue <Plus size={13} />
                  </button>
                )}
                {busy ? (
                  <button
                    type="button"
                    className="send-button stop-button"
                    aria-label="Stop response"
                    onClick={stopResponse}
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="submit"
                    aria-label="Send message"
                    disabled={!draft.trim() || !config || loading || (!!active && !connected)}
                  >
                    <ArrowUp size={20} />
                  </button>
                )}
              </div>
            </div>
          </form>
          <div className="composer-bottom">
            <button type="button" className="commands-button" onClick={() => setCommandsOpen(true)}>
              Commands /
            </button>
            <ContextMeter snapshot={snapshot} />
            <p className="composer-disclaimer">
              Pi can edit files and run commands. Review important changes.
            </p>
          </div>
        </div>
      </main>
      {inspectorOpen && (
        <Inspector
          chatId={active}
          events={snapshot?.events ?? []}
          close={() => setInspectorOpen(false)}
        />
      )}
      {commandsOpen && (
        <Commands
          close={() => setCommandsOpen(false)}
          choose={(command) => {
            setDraft(command);
            setCommandsOpen(false);
            textarea.current?.focus();
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          value={preferences}
          version={appVersion}
          updates={() => {
            setSettingsOpen(false);
            setUpdatesOpen(true);
          }}
          save={(next) => {
            setPreferences(next);
            setSoundNotice('');
          }}
          close={() => setSettingsOpen(false)}
        />
      )}
      {piSessionsOpen && (
        <PiSessionBrowser
          close={() => setPiSessionsOpen(false)}
          imported={(chat) => {
            setChats((current) => [chat, ...current]);
            selectChat(chat.id);
            setPiSessionsOpen(false);
            if (window.innerWidth <= 760) setSidebar(false);
          }}
        />
      )}
      {workspaceOpen && (
        <WorkspaceDialog
          value={currentChat?.cwd ?? cwd}
          locked={!!active}
          close={() => setWorkspaceOpen(false)}
          save={(value) => {
            setCwd(value);
            setWorkspaceOpen(false);
          }}
        />
      )}
      <KeyboardShortcut action={newChat} />
    </div>
  );
}
function KeyboardShortcut({ action }: { action: () => void }) {
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        action();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [action]);
  return null;
}
