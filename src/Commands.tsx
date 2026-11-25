import { useEffect, useRef } from 'react';

export const webCommands = [
  [
    '/subagent',
    'Enable read-only research agents. Also: on, off, status. Extra model usage applies.',
  ],
  ['/compact', 'Compact this conversation; optionally add compaction instructions.'],
  ['/model', 'Show current model, or /model provider/model-id to switch.'],
  ['/thinking', 'Set off, minimal, low, medium, high, or xhigh (model permitting).'],
  ['/stop', 'Stop the current response and pause the prompt queue.'],
  ['/new', 'Start a new web conversation.'],
  ['/settings', 'Open web settings.'],
  ['/resume', 'Browse and independently import existing terminal sessions.'],
  ['/diff', 'Open read-only workspace changes and configured tests.'],
  ['/help', 'Show this command menu.'],
];
export default function Commands({
  close,
  choose,
}: {
  close: () => void;
  choose: (command: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="workspace-dialog command-dialog"
      onCancel={close}
      aria-label="Web commands"
    >
      <div className="dialog-heading">
        <h2>Web commands</h2>
        <button className="secondary-button" onClick={close}>
          Close
        </button>
      </div>
      <p>Type a command in the composer, or choose one below.</p>
      <div className="command-list">
        {webCommands.map(([name, description]) => (
          <button key={name} onClick={() => choose(name)}>
            <strong>{name}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <p>
        Terminal parity: model selection, compaction, thinking, session import, settings, stop, and
        research delegation have web equivalents. Terminal-only commands (login/logout, packages,
        extensions, themes, interactive session trees, export, and shell shortcuts) are not executed
        here. Use Pi in your terminal for these. Arbitrary terminal extensions remain disabled.
      </p>
    </dialog>
  );
}
