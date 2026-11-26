import { useEffect, useRef, useState } from 'react';

export interface PromptTemplate {
  shortcut: string;
  name: string;
  text: string;
}
const STORAGE_KEY = 'pi-chat-prompt-templates';
export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    shortcut: '/review',
    name: 'Code Review',
    text: 'Review the current changes for correctness, security, and missing tests. Report concrete findings with file references. Do not edit files yet.',
  },
  {
    shortcut: '/debug',
    name: 'Fehler analysieren',
    text: 'Investigate this failure, identify its root cause, and propose a minimal fix. Explain how to verify the fix.\n\n',
  },
  {
    shortcut: '/tests',
    name: 'Tests ergänzen',
    text: 'Identify missing test coverage for the current changes and add focused regression tests. Run the relevant tests and report their results.',
  },
];
const RESERVED = new Set([
  '/help',
  '/new',
  '/settings',
  '/resume',
  '/diff',
  '/stop',
  '/model',
  '/thinking',
  '/compact',
  '/subagent',
]);

function validTemplate(value: unknown): value is PromptTemplate {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PromptTemplate>;
  return (
    typeof item.shortcut === 'string' &&
    /^\/[a-z][a-z0-9-]{1,31}$/.test(item.shortcut) &&
    !RESERVED.has(item.shortcut) &&
    typeof item.name === 'string' &&
    !!item.name.trim() &&
    item.name.length <= 80 &&
    typeof item.text === 'string' &&
    !!item.text.trim() &&
    item.text.length <= 20000
  );
}

export function readTemplates(): PromptTemplate[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (
      Array.isArray(raw) &&
      raw.length <= 50 &&
      raw.every(validTemplate) &&
      new Set(raw.map((item) => item.shortcut)).size === raw.length
    )
      return raw;
  } catch {
    /* Corrupt/blocked local storage must not prevent opening the app. */
  }
  return DEFAULT_TEMPLATES;
}

export function expandTemplate(text: string, templates: PromptTemplate[]) {
  const trimmed = text.trim();
  const match = templates.find(
    (item) =>
      trimmed === item.shortcut ||
      trimmed.startsWith(`${item.shortcut} `) ||
      trimmed.startsWith(`${item.shortcut}\n`),
  );
  return match ? `${match.text}\n\n${trimmed.slice(match.shortcut.length).trim()}`.trim() : text;
}

export default function PromptTemplates({
  templates,
  save,
  choose,
  close,
}: {
  templates: PromptTemplate[];
  save: (items: PromptTemplate[]) => void;
  choose: (text: string) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function persist(items: PromptTemplate[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      save(items);
      setError('');
      return true;
    } catch {
      setError('Could not save templates in this browser.');
      return false;
    }
  }

  return (
    <dialog
      ref={dialog}
      className="workspace-dialog productivity-dialog"
      aria-label="Prompt templates"
      onCancel={close}
    >
      <div className="dialog-heading">
        <h2>Prompt templates</h2>
        <button className="secondary-button" onClick={close}>
          Close
        </button>
      </div>
      <p>
        Saved in this browser. Shortcuts expand when sent; choosing a template only fills the
        composer.
      </p>
      <div className="template-list">
        {templates.map((item) => (
          <div key={item.shortcut}>
            <button className="secondary-button" onClick={() => choose(item.text)}>
              {item.name} <small>{item.shortcut}</small>
            </button>
            <button
              className="secondary-button"
              aria-label={`Edit ${item.name}`}
              onClick={() => {
                setEditing(item.shortcut);
                setName(item.name);
                setShortcut(item.shortcut);
                setText(item.text);
              }}
            >
              Edit
            </button>
            <button
              className="secondary-button"
              aria-label={`Delete template ${item.name}`}
              onClick={() => {
                if (window.confirm(`Delete template “${item.name}”?`))
                  persist(templates.filter((other) => other.shortcut !== item.shortcut));
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <form
        className="template-editor"
        onSubmit={(event) => {
          event.preventDefault();
          const item = { name: name.trim(), shortcut: shortcut.trim(), text: text.trim() };
          if (!validTemplate(item)) {
            setError(
              'Use a unique /shortcut (2–32 lowercase letters/digits/hyphens), a name, and prompt text. Built-in commands are reserved.',
            );
            return;
          }
          const others = templates.filter((other) => other.shortcut !== editing);
          if (others.length >= 50 || others.some((other) => other.shortcut === item.shortcut)) {
            setError('Shortcut already exists or 50-template limit reached.');
            return;
          }
          if (persist([...others, item])) {
            setEditing(undefined);
            setName('');
            setShortcut('');
            setText('');
          }
        }}
      >
        <h3>{editing ? 'Edit template' : 'Add template'}</h3>
        <label>
          Name
          <input
            aria-label="Template name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          Shortcut
          <input
            aria-label="Template shortcut"
            value={shortcut}
            placeholder="/review"
            onChange={(event) => setShortcut(event.target.value)}
            required
          />
        </label>
        <label>
          Prompt
          <textarea
            aria-label="Template prompt"
            value={text}
            maxLength={20000}
            rows={5}
            onChange={(event) => setText(event.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="secondary-button" type="submit">
          Save template
        </button>
        {editing && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setEditing(undefined);
              setName('');
              setShortcut('');
              setText('');
            }}
          >
            Cancel editing
          </button>
        )}
      </form>
    </dialog>
  );
}
