import type { Chat, Message } from './api';
import { downloadMarkdown } from './markdown-export';

interface Props {
  chat?: Chat;
  messages: Message[];
  selectedResponses: number[];
  busy: boolean;
  mac: boolean;
  openPalette: () => void;
  openTemplates: () => void;
  openUsage: () => void;
  update: (chat: Chat, values: Partial<Chat>) => Promise<void>;
}

export default function ConversationActions({
  chat,
  messages,
  selectedResponses,
  busy,
  mac,
  openPalette,
  openTemplates,
  openUsage,
  update,
}: Props) {
  const selected = messages.filter(
    (message, index) => message.role === 'assistant' && selectedResponses.includes(index),
  );
  return (
    <div className="conversation-actions" aria-label="Conversation actions">
      <button className="secondary-button" onClick={openPalette}>
        Search / {mac ? '⌘ K' : 'Ctrl K'}
      </button>
      <button className="secondary-button" onClick={openTemplates}>
        Templates
      </button>
      <button className="secondary-button" onClick={openUsage}>
        Usage limits
      </button>
      <button
        className="secondary-button"
        disabled={!messages.length}
        onClick={() => downloadMarkdown(chat?.title ?? 'Conversation', messages)}
      >
        Export chat
      </button>
      {selected.length > 0 && (
        <button
          className="secondary-button"
          onClick={() => downloadMarkdown(chat?.title ?? 'Selected responses', selected)}
        >
          Export selected ({selected.length})
        </button>
      )}
      {chat && (
        <label className="approval-toggle">
          <input
            type="checkbox"
            aria-label="Require action approvals"
            checked={!!chat.approvalMode}
            disabled={busy}
            onChange={(event) => {
              const enabled = event.target.checked;
              if (
                window.confirm(
                  enabled
                    ? 'Require approval before every write, edit, shell command, and configured test? Read-only research stays available. This is not a sandbox: approved commands and trusted workspace code retain local access.'
                    : 'Disable approvals? Future file changes, shell commands, and configured tests can run without confirmation.',
                )
              )
                void update(chat, { approvalMode: enabled });
            }}
          />
          Require approvals
        </label>
      )}
    </div>
  );
}
