import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, ChevronDown, Code2, Copy, Folder, LoaderCircle, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, Plus, Search, Sparkles, Square, Terminal, Trash2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Chat, type Config, type Message, type Snapshot } from './api';
import InstructionFiles from './Instructions';

const starters = [
  { icon: Code2, title: 'Build something new', text: 'Help me plan and build a new application in this workspace.' },
  { icon: Search, title: 'Explore a codebase', text: 'Explore this workspace and explain its structure and main components.' },
  { icon: Terminal, title: 'Find and fix a bug', text: 'Help me investigate a bug. Start by asking what is going wrong.' },
];
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="icon-button" aria-label="Copy message" title={copied ? 'Copied' : 'Copy'} onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>;
}
function MessageView({ message }: { message: Message }) {
  if (message.role === 'toolResult') return <details className={`tool-result ${message.isError ? 'failed' : ''}`}><summary><Terminal size={14} /><span>{message.toolName ?? 'Tool'} {message.isError ? 'failed' : 'output'}</span><ChevronDown size={13} /></summary><pre>{message.text || 'Completed without output.'}</pre></details>;
  const user = message.role === 'user';
  return <article className={`message ${user ? 'user-message' : 'assistant-message'}`}>
    {!user && <div className="message-author"><span className="pi-avatar">π</span>Pi <span>CODING AGENT</span></div>}
    <div className={`message-body ${message.isError ? 'failed' : ''}`}>{user ? <p>{message.text}</p> : <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{message.text}</Markdown>}</div>
    <div className="message-actions"><CopyButton text={message.text} /></div>
  </article>;
}
export default function App() {
  const [config, setConfig] = useState<Config>();
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState<string | null>(() => localStorage.getItem('pi-chat-active'));
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('');
  const [cwd, setCwd] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 760);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(!!active);
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const submitting = useRef(false);
  const busy = !!snapshot?.busy || sending;
  async function refreshChats() { const list = await api<Chat[]>('/chats'); setChats(list); return list; }
  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Config>('/config'), api<Chat[]>('/chats')]).then(([settings, list]) => {
      if (cancelled) return;
      setConfig(settings); setCwd(settings.defaultCwd); setChats(list);
      setActive(current => current && list.some(c => c.id === current) ? current : null);
    }).catch(e => !cancelled && setError(errorText(e)));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    setSnapshot(undefined); setConnected(false); setLoading(!!active); follow.current = true;
    if (!active) { localStorage.removeItem('pi-chat-active'); return; }
    localStorage.setItem('pi-chat-active', active);
    const source = new EventSource(`/api/chats/${active}/events`);
    source.onopen = () => setConnected(true);
    source.onmessage = event => {
      const next: Snapshot = JSON.parse(event.data);
      setSnapshot(next); setLoading(false);
      setChats(current => [next.chat, ...current.filter(c => c.id !== next.chat.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    };
    source.onerror = () => { setConnected(false); };
    return () => source.close();
  }, [active]);
  useEffect(() => {
    if (snapshot?.messages.length && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot, sending]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`; } }, [draft]);
  function newChat() { setActive(null); setDraft(''); setError(''); setLoading(false); if (window.innerWidth <= 760) setSidebar(false); textarea.current?.focus(); }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || busy || submitting.current || !config) return;
    submitting.current = true; setSending(true); setError(''); follow.current = true;
    const text = draft;
    try {
      let id = active;
      if (!id) { const chat = await api<Chat>('/chats', { method: 'POST', body: JSON.stringify({ cwd }) }); id = chat.id; setActive(id); }
      await api(`/chats/${id}/messages`, { method: 'POST', body: JSON.stringify({ text, ...(model ? { model } : {}) }) });
      setDraft(''); await refreshChats();
    } catch (e) { setError(errorText(e)); }
    finally { submitting.current = false; setSending(false); textarea.current?.focus(); }
  }
  async function rename(chat: Chat) {
    const title = window.prompt('Rename chat', chat.title);
    if (!title?.trim()) return;
    try { await api(`/chats/${chat.id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); await refreshChats(); }
    catch (e) { setError(errorText(e)); }
  }
  async function remove(chat: Chat) {
    if (!window.confirm(`Delete “${chat.title}”? This removes its local conversation history, not workspace files.`)) return;
    try { await api(`/chats/${chat.id}`, { method: 'DELETE', body: '{}' }); if (active === chat.id) newChat(); await refreshChats(); }
    catch (e) { setError(errorText(e)); }
  }
  const currentChat = chats.find(chat => chat.id === active);
  const messages = snapshot?.messages ?? [];
  const selectedModel = model || snapshot?.model || '';
  const visibleChats = chats.filter(chat => `${chat.title} ${chat.cwd}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="app-shell">
    {sidebar && <><button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebar(false)} /><aside className="sidebar">
      <div className="brand-row"><a className="brand" href="/" onClick={e => { e.preventDefault(); newChat(); }}><span className="brand-mark">π</span>Chat<span className="brand-badge">for Pi</span></a><button className="icon-button" aria-label="Close sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={18} /></button></div>
      <button className="new-chat" onClick={newChat}><Plus size={18} />New chat<span>⌘ K</span></button>
      <label className="search-box"><Search size={15} /><input aria-label="Search chats" placeholder="Search conversations" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="history-heading">YOUR CONVERSATIONS <span>{chats.length}</span></div>
      <nav className="chat-list" aria-label="Conversations">{visibleChats.length ? visibleChats.map(chat => <div className={`chat-item ${active === chat.id ? 'active' : ''}`} key={chat.id}>
        <button className="chat-select" title={chat.cwd} onClick={() => { setActive(chat.id); setDraft(''); setError(''); if (window.innerWidth <= 760) setSidebar(false); }}><MessageSquare size={15} /><span>{chat.title}</span></button>
        <div className="chat-item-actions"><button className="icon-button" aria-label={`Rename ${chat.title}`} onClick={() => void rename(chat)}><MoreHorizontal size={14} /></button><button className="icon-button" aria-label={`Delete ${chat.title}`} onClick={() => void remove(chat)}><Trash2 size={13} /></button></div>
      </div>) : <div className="empty-history">{search ? 'No matching conversations.' : 'A little space for your next big idea. Start a conversation.'}</div>}</nav>
      <InstructionFiles chatId={active} />
      <div className="sidebar-footer"><span className="local-dot" /><div><strong>Your local workspace</strong><small>Powered by Pi coding agent</small></div><span className="local-label">LOCAL</span></div>
    </aside></>}
    <main className="main-panel">
      <header className="topbar"><div className="topbar-left">{!sidebar && <button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebar(true)}><Menu size={20} /></button>}<span className="page-title">{currentChat?.title ?? 'New conversation'}</span><span className="subtle-pill">Pi agent</span></div><button className="workspace-button" onClick={() => setWorkspaceOpen(true)} title={currentChat?.cwd ?? cwd}><Folder size={14} /><span>{(currentChat?.cwd ?? cwd).split('/').filter(Boolean).at(-1) || 'Workspace'}</span><ChevronDown size={13} /></button></header>
      <div className="conversation-scroll" ref={scroll} onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        {!messages.length && !loading ? <section className="welcome"><div className="welcome-label"><span />YOUR IDEAS. YOUR WORKSPACE.</div><div className="welcome-logo">π<span /></div><h1>What will we build<span>today?</span></h1><p>A conversation away from your next idea.<br />Write, explore, and build with Pi in your own workspace.</p><div className="starters">{starters.map(item => <button key={item.title} onClick={() => { setDraft(item.text); textarea.current?.focus(); }}><item.icon size={20} /><strong>{item.title}</strong><span>{item.text}</span><span className="starter-arrow">↗</span></button>)}</div><div className="welcome-note"><Folder size={13} />Working in <button onClick={() => setWorkspaceOpen(true)}>{(currentChat?.cwd ?? cwd).replace(/^\/Users\/[^/]+/, '~') || 'your workspace'}</button></div></section> : <section className="transcript" aria-label="Chat messages">{loading && <div className="status-line"><LoaderCircle size={16} className="spin" />Loading conversation…</div>}{messages.map((message, index) => <MessageView key={index} message={message} />)}{busy && <div className="status-line" role="status"><LoaderCircle size={15} className="spin" />{snapshot?.tool ? `Running ${snapshot.tool}…` : 'Pi is working…'}</div>}</section>}
      </div>
      <div className="composer-area">{(error || snapshot?.error) && <div className="error-banner" role="alert">{error || snapshot?.error}<button className="icon-button" aria-label="Dismiss error" onClick={() => { setError(''); setSnapshot(s => s ? { ...s, error: undefined } : s); }}><X size={14} /></button></div>}{active && !connected && <div className="connection-notice" role="status">Connecting to your session… If the server stopped, restart it with npm run dev.</div>}
        <form className="composer" onSubmit={e => void send(e)}><textarea ref={textarea} aria-label="Message Pi" placeholder="Ask Pi anything, or describe what you want to build…" rows={2} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-toolbar"><div className="model-picker"><Sparkles size={14} /><select aria-label="Model" value={selectedModel} disabled={busy || !config} onChange={e => setModel(e.target.value)}><option value="">Pi default model</option>{config?.models.map(m => <option value={m.key} key={m.key}>{m.name} · {m.provider}</option>)}</select><ChevronDown size={12} /></div><div className="composer-right"><span className="enter-hint">↵ to send</span>{busy ? <button type="button" className="send-button stop-button" aria-label="Stop response" onClick={() => { if (active) void api(`/chats/${active}/stop`, { method: 'POST', body: '{}' }).catch(e => setError(errorText(e))); }}><Square size={16} fill="currentColor" /></button> : <button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || !config || loading || (!!active && !connected)}><ArrowUp size={20} /></button>}</div></div></form>
        <p className="composer-disclaimer">Pi can edit files and run commands in your workspace. Review important changes.</p>
      </div>
    </main>
    {workspaceOpen && <WorkspaceDialog value={currentChat?.cwd ?? cwd} locked={!!active} close={() => setWorkspaceOpen(false)} save={value => { setCwd(value); setWorkspaceOpen(false); }} />}
    <KeyboardShortcut action={newChat} />
  </div>;
}
function WorkspaceDialog({ value, locked, close, save }: { value: string; locked: boolean; close: () => void; save: (value: string) => void }) {
  const [input, setInput] = useState(value);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="workspace-dialog" onCancel={close}><form onSubmit={e => { e.preventDefault(); save(input.trim()); }}><div className="dialog-heading"><span className="pi-avatar"><Folder size={19} /></span><button type="button" className="icon-button" aria-label="Close workspace dialog" onClick={close}><X size={18} /></button></div><h2>Your workspace</h2><p>{locked ? 'This conversation is attached to this directory. Start a new chat to choose another workspace.' : 'Choose a local directory for this conversation. Pi can read and change files here, and run commands with your user permissions.'}</p><label htmlFor="workspace-path">Working directory</label><input id="workspace-path" autoFocus value={input} disabled={locked} onChange={e => setInput(e.target.value)} placeholder="/path/to/your/project" /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button" disabled={!input.trim()}>{locked ? 'Done' : 'Use workspace'}</button></div></form></dialog>;
}
function KeyboardShortcut({ action }: { action: () => void }) {
  useEffect(() => { function handler(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); action(); } } window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [action]);
  return null;
}
