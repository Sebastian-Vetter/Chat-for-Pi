import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  Download,
  File,
  Folder,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from './api';

export type FileTarget = { id: string; remote: boolean };
export function sharedRequest<T>(
  target: FileTarget,
  operation: string,
  data: Record<string, unknown> = {},
) {
  return api<T>(
    target.remote ? `/shared/joined/${target.id}/rpc` : `/shared/sessions/${target.id}/files`,
    {
      method: 'POST',
      body: JSON.stringify(target.remote ? { operation, data } : { operation, ...data }),
    },
  );
}
interface Entry {
  name: string;
  directory: boolean;
  size: number;
}
interface FileData {
  data: string;
  hash: string | null;
}
function bytes(data: string) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}
function download(path: string, data: string) {
  const url = URL.createObjectURL(new Blob([bytes(data)]));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split('/').at(-1) ?? 'file';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Editor({
  path,
  value,
  writable,
  target,
  close,
  changed,
}: {
  path: string;
  value: FileData;
  writable: boolean;
  target: FileTarget;
  close: () => void;
  changed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [original, setOriginal] = useState(value);
  const decoded = (() => {
    try {
      if (value.data.length > 1400000) return null;
      const text = new TextDecoder('utf8', { fatal: true }).decode(bytes(value.data));
      return text.includes('\0') ? null : text;
    } catch {
      return null;
    }
  })();
  const [text, setText] = useState(decoded ?? '');
  const [savedText, setSavedText] = useState(decoded ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function dismiss() {
    if (text === savedText || window.confirm('Discard unsaved file changes?')) close();
  }
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog shared-editor"
      aria-label={`Shared file ${path}`}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="dialog-heading">
        <h2>{path}</h2>
        <button className="icon-button" aria-label="Close shared file" onClick={dismiss}>
          <X size={16} />
        </button>
      </div>
      {decoded === null ? (
        <p>Binary or large file. Download to view it locally (8 MiB maximum).</p>
      ) : (
        <textarea
          aria-label="Shared file content"
          value={text}
          readOnly={!writable}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />
      )}
      {error && <p role="alert">{error}</p>}
      <div className="shared-actions">
        <button className="secondary-button" onClick={() => download(path, original.data)}>
          <Download size={14} />
          Download
        </button>
        {writable && decoded !== null && (
          <button
            className="secondary-button"
            disabled={saving || (original.hash !== null && text === savedText)}
            onClick={async () => {
              setSaving(true);
              try {
                const data = await base64(new Blob([text]));
                const result = await sharedRequest<{ hash: string }>(target, 'write', {
                  path,
                  data,
                  hash: original.hash,
                });
                setOriginal({ data, hash: result.hash });
                setSavedText(text);
                setError('');
                changed();
              } catch (error) {
                setError(String(error));
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save size={14} />
            Save file
          </button>
        )}
        {writable && original.hash !== null && (
          <button
            className="secondary-button"
            disabled={saving}
            onClick={async () => {
              if (!window.confirm(`Delete ${path} from the shared project?`)) return;
              setSaving(true);
              try {
                await sharedRequest(target, 'remove', { path, hash: original.hash });
                changed();
                close();
              } catch (error) {
                setError(String(error));
                setSaving(false);
              }
            }}
          >
            <Trash2 size={14} />
            Delete file
          </button>
        )}
      </div>
    </dialog>
  );
}

export default function SharedFiles({
  target,
  writable,
}: {
  target: FileTarget;
  writable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ path: string; value: FileData }>();
  useEffect(() => {
    if (!open) return;
    let cancelled = false,
      loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await sharedRequest<Entry[]>(target, 'list', { path });
        if (!cancelled) {
          setEntries(next);
          setError('');
        }
      } catch (error) {
        if (!cancelled) setError(String(error));
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [target.id, target.remote, path, open, revision]);
  const child = (name: string) => (path ? `${path}/${name}` : name);
  return (
    <div className="shared-files">
      <button
        className="shared-files-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Folder size={14} />
        Files<span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <>
          <div className="shared-file-tools">
            <button
              className="icon-button"
              aria-label="Parent shared folder"
              disabled={!path}
              onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
            >
              <ChevronLeft size={14} />
            </button>
            <span title={path}>{path || 'Project'}</span>
            <button
              className="icon-button"
              aria-label="Refresh shared files"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={13} />
            </button>
            {writable && (
              <>
                <button
                  className="icon-button"
                  aria-label="New shared file"
                  onClick={() => {
                    const name = window.prompt('New file path, relative to this folder');
                    if (name) setEditing({ path: child(name), value: { data: '', hash: null } });
                  }}
                >
                  <Plus size={14} />
                </button>
                <label className="shared-upload" title="Upload file (8 MiB maximum)">
                  <Upload size={14} />
                  <input
                    type="file"
                    aria-label="Upload shared file"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      try {
                        if (file.size > 8 * 1024 * 1024)
                          throw new Error('Maximum file size is 8 MiB');
                        await sharedRequest(target, 'write', {
                          path: child(file.name),
                          data: await base64(file),
                          hash: null,
                        });
                        setRevision((value) => value + 1);
                      } catch (error) {
                        setError(String(error));
                      }
                    }}
                  />
                </label>
              </>
            )}
          </div>
          {error && (
            <p className="shared-error" role="alert">
              {error}
            </p>
          )}
          <div className="shared-file-list">
            {entries.length ? (
              entries.map((entry) => (
                <button
                  key={entry.name}
                  title={entry.name}
                  onClick={async () => {
                    if (entry.directory) {
                      setPath(child(entry.name));
                      return;
                    }
                    try {
                      const value = await sharedRequest<FileData>(target, 'read', {
                        path: child(entry.name),
                      });
                      setEditing({ path: child(entry.name), value });
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  {entry.directory ? <Folder size={13} /> : <File size={13} />}
                  <span>{entry.name}</span>
                </button>
              ))
            ) : (
              <p>No files yet.</p>
            )}
          </div>
        </>
      )}
      {editing && (
        <Editor
          key={editing.path}
          path={editing.path}
          value={editing.value}
          writable={writable}
          target={target}
          close={() => setEditing(undefined)}
          changed={() => setRevision((value) => value + 1)}
        />
      )}
    </div>
  );
}
