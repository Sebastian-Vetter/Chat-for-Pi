import { useEffect, useRef, useState } from 'react';

export interface PaletteAction {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  run: () => void;
}

export default function CommandPalette({
  actions,
  close,
}: {
  actions: PaletteAction[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const matches = actions
    .filter((action) =>
      `${action.kind} ${action.label} ${action.detail ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 100);
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);

  function activate(action: PaletteAction) {
    close();
    action.run();
  }

  return (
    <dialog
      ref={dialog}
      className="workspace-dialog productivity-dialog"
      aria-label="Command palette"
      onCancel={close}
    >
      <div className="dialog-heading">
        <h2>Command palette</h2>
        <button className="secondary-button" onClick={close}>
          Close
        </button>
      </div>
      <input
        autoFocus
        role="combobox"
        aria-label="Search commands, chats, projects and models"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={matches.length ? `palette-result-${index}` : undefined}
        value={query}
        placeholder="Search chats, projects, models, actions…"
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected(
              (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                Math.max(1, matches.length),
            );
          }
          if (event.key === 'Enter' && matches[index]) {
            event.preventDefault();
            activate(matches[index]);
          }
        }}
      />
      <div
        id="palette-results"
        role="listbox"
        aria-label="Matching commands"
        className="palette-results"
      >
        {matches.map((action, itemIndex) => (
          <button
            id={`palette-result-${itemIndex}`}
            key={action.id}
            role="option"
            aria-selected={index === itemIndex}
            tabIndex={-1}
            onClick={() => activate(action)}
          >
            <small>{action.kind}</small>
            <strong>{action.label}</strong>
            <span>{action.detail}</span>
          </button>
        ))}
      </div>
      {!matches.length && <p role="status">No matching commands.</p>}
      <p>↑ ↓ to navigate · Enter to choose · Escape to close</p>
    </dialog>
  );
}
