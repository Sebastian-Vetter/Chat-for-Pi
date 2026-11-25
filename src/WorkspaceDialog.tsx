import { useEffect, useRef, useState } from 'react';
import { Folder, X } from 'lucide-react';

interface WorkspaceDialogProps {
  value: string;
  locked: boolean;
  close: () => void;
  save: (value: string) => void;
}

export default function WorkspaceDialog({ value, locked, close, save }: WorkspaceDialogProps) {
  const [input, setInput] = useState(value);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="workspace-dialog" onCancel={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(input.trim());
        }}
      >
        <div className="dialog-heading">
          <span className="pi-avatar">
            <Folder size={19} />
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close workspace dialog"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <h2>Your workspace</h2>
        <p>
          {locked
            ? 'This conversation is attached to this directory. Start a new chat to choose another workspace.'
            : 'Choose a local directory for this conversation. Pi can read and change files here, and run commands with your user permissions.'}
        </p>
        <label htmlFor="workspace-path">Working directory</label>
        <input
          id="workspace-path"
          autoFocus
          value={input}
          disabled={locked}
          onChange={(event) => setInput(event.target.value)}
          placeholder="/path/to/your/project"
        />
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!input.trim()}>
            {locked ? 'Done' : 'Use workspace'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
