import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Chat, type Message } from './api';
interface PiSession { key: string; title: string; cwd: string; modified: string; messageCount: number }
export default function PiSessionBrowser({ close, imported }: { close: () => void; imported: (chat: Chat) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sessions, setSessions] = useState<PiSession[]>([]);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PiSession>();
  const [preview, setPreview] = useState<{ messages: Message[] }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true);
    const timer = setTimeout(() => void api<{ sessions: PiSession[]; total: number }>(`/pi-sessions?q=${encodeURIComponent(query)}&offset=${offset}`).then(data => { if (!cancelled) { setSessions(data.sessions); setTotal(data.total); setLoading(false); } }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } }), 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, offset]);
  useEffect(() => {
    let cancelled = false; setPreview(undefined); setError('');
    if (selected) void api<{ messages: Message[] }>(`/pi-sessions/${selected.key}`).then(data => { if (!cancelled) setPreview(data); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [selected]);
  async function copy() {
    if (!selected) return; setImporting(true);
    try { const chat = await api<Chat>(`/pi-sessions/${selected.key}/import`, { method: 'POST', body: '{}' }); imported(chat); }
    catch (e) { setError((e as Error).message); } finally { setImporting(false); }
  }
  return <dialog ref={dialog} className="file-dialog session-browser" aria-label="Existing Pi sessions" onCancel={close}><div className="file-dialog-heading"><strong>Your Pi sessions</strong><span>{total} found</span><button className="icon-button" aria-label="Close Pi sessions" onClick={close}><X size={18} /></button></div><p className="file-notice">Browse sessions saved by your Pi CLI across workspaces. Continue creates an independent web copy; it never writes to the original terminal session. Workspaces outside this Mac or unavailable directories cannot be resumed.</p><label className="session-search"><Search size={15} /><input aria-label="Search Pi sessions" value={query} placeholder="Search sessions and workspaces…" onChange={e => { setQuery(e.target.value); setOffset(0); }} /></label>{error && <p className="inspector-error" role="alert">{error}</p>}<div className="session-browser-body"><div className="pi-session-list">{loading ? <p className="inspector-caption">Reading Pi sessions…</p> : !sessions.length ? <p className="inspector-caption">No saved sessions found.</p> : sessions.map(session => <button key={session.key} className={selected?.key === session.key ? 'active' : ''} onClick={() => setSelected(session)}><strong>{session.title}</strong><small>{session.cwd}</small><span>{new Date(session.modified).toLocaleDateString()} · {session.messageCount} messages</span></button>)}<div className="session-pagination"><button disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button disabled={offset + 50 >= total || loading} onClick={() => setOffset(offset + 50)}>Next</button></div></div><div className="pi-session-preview">{!selected ? <p className="inspector-caption">Choose a session to preview it.</p> : !preview ? <p className="inspector-caption">Loading conversation…</p> : <>{preview.messages.map((message, i) => <div key={i} className="preview-message"><strong>{message.role === 'toolResult' ? message.toolName : message.role}</strong><div className="message-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml>{message.text}</Markdown></div></div>)}</>}</div></div><div className="session-browser-footer"><span>Read-only preview · original history is preserved</span><button className="primary-button" disabled={!selected || importing} onClick={() => void copy()}>{importing ? 'Creating copy…' : 'Continue as web conversation'}<ArrowRight size={14} /></button></div></dialog>;
}
