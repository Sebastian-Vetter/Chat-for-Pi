import { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import type { Snapshot } from './api';
export default function ThinkingPanel({ snapshot }: { snapshot?: Snapshot }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!snapshot?.busy) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [snapshot?.busy]);
  if (!snapshot?.busy) return null;
  const currentRun = snapshot.events?.findLast(e => e.type === 'agent' && e.status === 'running');
  const tools = snapshot.events?.filter(e => e.type === 'tool' && e.status === 'running') ?? [];
  const elapsed = currentRun ? Math.max(0, Math.floor((now - Date.parse(currentRun.timestamp)) / 1000)) : 0;
  const describe = (label: string, detail?: string) => {
    let args: Record<string, unknown> = {}; try { args = JSON.parse(detail ?? '{}'); } catch {}
    const path = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
    if (['write', 'edit'].includes(label)) return `Editing ${path || 'workspace files'}`;
    if (label === 'read') return `Reading ${path || 'workspace files'}`;
    if (label === 'bash') return typeof args.command === 'string' ? `Running: ${args.command.slice(0, 160)}` : 'Running a shell command';
    return `Using ${label}`;
  };
  return <details className="thinking-panel" open><summary><LoaderCircle size={14} className="spin" /><strong>Thinking & activity</strong><span>{elapsed}s</span><ChevronDown size={13} /></summary><p>{tools.length ? 'Pi is using workspace tools.' : 'Pi is preparing a response.'}</p>{tools.map(tool => <div className="thinking-step" key={tool.id}><i /><span>{describe(tool.label, tool.detail)}</span></div>)}<small>This is observable progress, not the model’s private internal reasoning. Expand tool events in Activity for full arguments.</small></details>;
}
