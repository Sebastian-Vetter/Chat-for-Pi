import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  FileCode2,
  FlaskConical,
  GitCompareArrows,
  LoaderCircle,
  Play,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { api, type ActivityEvent } from './api';
interface ChangedFile {
  path: string;
  oldPath?: string;
  status: string;
  staged: boolean;
  untracked: boolean;
}
interface Changes {
  available: boolean;
  root: string;
  branch: string;
  files: ChangedFile[];
  note: string;
}
interface Tasks {
  tasks: { id: string; name: string; command: string }[];
  running: boolean;
  runs: ActivityEvent[];
}
export default function Inspector({
  chatId,
  events,
  close,
}: {
  chatId: string | null;
  events: ActivityEvent[];
  close: () => void;
}) {
  const [tab, setTab] = useState<'changes' | 'tests' | 'activity'>('changes');
  const [changes, setChanges] = useState<Changes>();
  const [tests, setTests] = useState<Tasks>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ChangedFile>();
  const [revision, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const settled = events
    .filter((e) => e.status !== 'running')
    .map((e) => `${e.id}:${e.status}`)
    .join('|');
  useEffect(() => {
    setSelected(undefined);
    setChanges(undefined);
    setTests(undefined);
    setError('');
  }, [chatId]);
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false,
      fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const [files, tasks] = await Promise.all([
          api<Changes>(`/chats/${chatId}/changes`),
          api<Tasks>(`/chats/${chatId}/tests`),
        ]);
        if (!cancelled) {
          setChanges(files);
          setTests(tasks);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        fetching = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chatId, settled, revision]);
  const running =
    !!tests?.running || events.some((e) => e.type === 'test' && e.status === 'running');
  async function start(taskId: string) {
    if (!chatId || pending) return;
    setPending(true);
    setError('');
    try {
      await api(`/chats/${chatId}/tests`, { method: 'POST', body: JSON.stringify({ taskId }) });
      refresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <aside className="inspector" aria-label="Workspace tools">
      <div className="inspector-heading">
        <strong>Workspace</strong>
        <span>LOCAL</span>
        <button
          className="icon-button"
          aria-label="Refresh workspace tools"
          onClick={() => {
            setError('');
            refresh((v) => v + 1);
          }}
        >
          <RefreshCw size={14} />
        </button>
        <button className="icon-button" aria-label="Close workspace tools" onClick={close}>
          <X size={17} />
        </button>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Workspace views">
        {(
          [
            { id: 'changes', icon: GitCompareArrows, name: 'Changes' },
            { id: 'tests', icon: FlaskConical, name: 'Tests' },
            { id: 'activity', icon: Activity, name: 'Activity' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <item.icon size={14} />
            {item.name}
            {item.id === 'changes' && !!changes?.files.length && (
              <span>{changes.files.length}</span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <div className="inspector-error" role="alert">
          {error}
        </div>
      )}
      <div className="inspector-content" role="tabpanel" aria-label={`${tab} panel`}>
        {!chatId ? (
          <div className="inspector-empty">
            <FileCode2 size={26} />
            <h3>Your workspace, in focus</h3>
            <p>
              Select a saved conversation or send your first message to see its Git changes, local
              tests, and coding activity.
            </p>
          </div>
        ) : tab === 'changes' ? (
          <>
            <p className="inspector-caption">
              All local changes against HEAD, including staged and new files. These may include
              edits made outside Pi.
            </p>
            {!changes ? (
              <p className="inspector-caption">Checking Git…</p>
            ) : !changes.available ? (
              <p className="inspector-caption">{changes.note}</p>
            ) : (
              <>
                <div className="git-branch">
                  ⑂ {changes.branch}
                  <span>{changes.files.length} changed</span>
                </div>
                {changes.files.length ? (
                  <div className="changed-files">
                    {changes.files.map((file) => (
                      <button
                        key={file.path}
                        className="changed-file"
                        title={file.path}
                        onClick={() => setSelected(file)}
                      >
                        <span className={`file-status ${file.untracked ? 'added' : ''}`}>
                          {file.status}
                        </span>
                        <span>
                          {file.path}
                          {file.oldPath && <small>from {file.oldPath}</small>}
                        </span>
                        {file.staged && <small className="staged-badge">staged</small>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="clean-state">
                    <Check size={20} />
                    <strong>Working tree clean</strong>
                    <p>File edits will appear here.</p>
                  </div>
                )}
              </>
            )}
          </>
        ) : tab === 'tests' ? (
          <>
            <p className="inspector-caption">
              Run configured tests on this Mac. Commands execute with your user permissions; review
              the workspace’s scripts first.
            </p>
            {!tests ? (
              <p className="inspector-caption">Finding test commands…</p>
            ) : !tests.tasks.length ? (
              <div className="inspector-empty">
                <FlaskConical size={25} />
                <h3>No local tests configured</h3>
                <p>
                  Supported: package.json test/check/lint/typecheck/build scripts, Cargo, Go, and
                  pytest configuration.
                </p>
              </div>
            ) : (
              <div className="test-tasks">
                {tests.tasks.map((task) => (
                  <div className="test-task" key={task.id}>
                    <div>
                      <strong>{task.name}</strong>
                      <code>{task.command}</code>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Run ${task.name}`}
                      disabled={running || pending}
                      onClick={() => void start(task.id)}
                    >
                      <Play size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {running && (
              <button
                className="stop-tests"
                disabled={pending}
                onClick={() => {
                  if (chatId)
                    void api(`/chats/${chatId}/tests/stop`, { method: 'POST', body: '{}' })
                      .then(() => refresh((v) => v + 1))
                      .catch((e) => setError(e.message));
                }}
              >
                <Square size={12} />
                Stop local tests
              </button>
            )}
            <div className="section-label">RECENT RUNS</div>
            {(events.length ? events.filter((e) => e.type === 'test') : (tests?.runs ?? []))
              .slice()
              .reverse()
              .map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
          </>
        ) : (
          <>
            <p className="inspector-caption">
              One row per coding run, assistant response, tool call, and local test run. Expand a
              row for details.
            </p>
            {!events.length && (
              <p className="inspector-caption">
                New coding events will appear here. Earlier chats are not backfilled.
              </p>
            )}
            {events
              .slice()
              .reverse()
              .map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
          </>
        )}
      </div>
      {selected && chatId && (
        <DiffDialog
          key={`${chatId}:${selected.path}`}
          chatId={chatId}
          file={selected}
          close={() => setSelected(undefined)}
        />
      )}
    </aside>
  );
}
function EventRow({ event }: { event: ActivityEvent }) {
  return (
    <details className={`activity-event event-${event.status}`}>
      <summary>
        <span className="event-status">
          {event.status === 'running' ? (
            <LoaderCircle size={13} className="spin" />
          ) : event.status === 'passed' ? (
            <Check size={13} />
          ) : event.status === 'failed' ? (
            <X size={13} />
          ) : (
            <Square size={11} />
          )}
        </span>
        <span className="event-label">
          {event.label}
          <small>
            {event.status} ·{' '}
            {new Date(event.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {event.durationMs !== undefined && ` · ${(event.durationMs / 1000).toFixed(1)}s`}
          </small>
        </span>
        <ChevronDown size={12} />
      </summary>
      {event.detail && <pre>{event.detail}</pre>}
    </details>
  );
}
function DiffDialog({
  chatId,
  file,
  close,
}: {
  chatId: string;
  file: ChangedFile;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [full, setFull] = useState(false);
  const [data, setData] = useState<{ patch: string; additions: number; deletions: number }>();
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError('');
    void api<{ patch: string; additions: number; deletions: number }>(
      `/chats/${chatId}/diff?path=${encodeURIComponent(file.path)}&full=${full ? 1 : 0}`,
    )
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, file.path, full]);
  let oldLine = 0,
    newLine = 0;
  return (
    <dialog
      ref={dialog}
      className="file-dialog diff-dialog"
      aria-label={`Diff for ${file.path}`}
      onCancel={close}
    >
      <div className="file-dialog-heading">
        <GitCompareArrows size={18} />
        <strong>{file.path}</strong>
        <button className="icon-button" aria-label="Close diff" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="file-dialog-toolbar">
        <span className="diff-counts">
          <b>+{data?.additions ?? 0}</b>
          <b>−{data?.deletions ?? 0}</b>
        </span>
        <label className="full-context">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          Full file context
        </label>
      </div>
      <div className="diff-content">
        {error ? (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        ) : !data ? (
          <p className="inspector-caption">Loading patch…</p>
        ) : (
          <div className="diff-lines">
            {data.patch.split('\n').map((line, i) => {
              const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
              if (hunk) {
                oldLine = Number(hunk[1]);
                newLine = Number(hunk[2]);
              }
              const meta =
                !!hunk ||
                /^(diff |index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename |Binary|\\)/.test(
                  line,
                ) ||
                (oldLine === 0 && newLine === 0);
              const added = !meta && line.startsWith('+'),
                removed = !meta && line.startsWith('-');
              return (
                <div
                  key={i}
                  className={`diff-line ${meta ? 'diff-meta' : added ? 'diff-added' : removed ? 'diff-removed' : ''}`}
                >
                  <span className="line-number">{meta || added ? '' : oldLine++}</span>
                  <span className="line-number">{meta || removed ? '' : newLine++}</span>
                  <code>{line || ' '}</code>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}
