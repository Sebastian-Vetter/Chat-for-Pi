import { useEffect, useRef, useState } from 'react';
import { FileText, RefreshCw, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from './api';
interface Instruction {
  path: string;
  name: string;
  scope: string;
  content: string;
  truncated: boolean;
}
interface Instructions {
  source: 'session' | 'discovered';
  files: Instruction[];
}
export default function InstructionFiles({ chatId }: { chatId: string | null }) {
  const [data, setData] = useState<Instructions>();
  const [selected, setSelected] = useState<Instruction>();
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setSelected(undefined);
    setError('');
    if (chatId)
      void api<Instructions>(`/chats/${chatId}/instructions`)
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [chatId, revision]);
  return (
    <section className="instruction-section" aria-label="Conversation instructions">
      <div className="history-heading">
        AGENTS.md{' '}
        <button
          className="icon-button"
          aria-label="Refresh instructions"
          disabled={!chatId}
          onClick={() => refresh((v) => v + 1)}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {!chatId ? (
        <p>Select a conversation to see its instructions.</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>Loading instructions…</p>
      ) : !data.files.length ? (
        <p>No AGENTS.md found for this workspace or its parent directories.</p>
      ) : (
        <>
          <div className="instruction-list">
            {data.files.map((file) => (
              <button
                key={file.path}
                className="instruction-file"
                title={file.path}
                onClick={() => setSelected(file)}
              >
                <FileText size={14} />
                <span>
                  <strong>{file.name}</strong>
                  <small>{file.scope}</small>
                </span>
              </button>
            ))}
          </div>
          <p>
            {data.source === 'session'
              ? 'Instructions loaded by this Pi session.'
              : 'Discovered for this workspace; loaded when Pi starts.'}
          </p>
        </>
      )}
      {selected && (
        <InstructionDialog
          file={selected}
          source={data?.source}
          close={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
function InstructionDialog({
  file,
  source,
  close,
}: {
  file: Instruction;
  source?: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="file-dialog"
      onCancel={close}
      aria-label={`${file.name} instructions`}
    >
      <div className="file-dialog-heading">
        <FileText size={18} />
        <strong>{file.name}</strong>
        <span>{file.scope}</span>
        <button className="icon-button" aria-label="Close instructions" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="file-dialog-toolbar">
        <code>{file.path}</code>
        <button className="secondary-button" onClick={() => setRaw(!raw)}>
          {raw ? 'Preview Markdown' : 'View source'}
        </button>
      </div>
      <p className="file-notice">
        Read-only ·{' '}
        {source === 'session'
          ? 'Showing the instructions loaded into the current Pi session. Later disk edits may differ until the session reloads.'
          : 'Showing instructions discovered on disk for this conversation’s workspace.'}
        {file.truncated && ' Display limited to 256 KB.'}
      </p>
      <div className="file-dialog-content">
        {raw ? (
          <pre>{file.content}</pre>
        ) : (
          <div className="message-body">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {file.content || '*This file is empty.*'}
            </Markdown>
          </div>
        )}
      </div>
    </dialog>
  );
}
