import { Download, FileDown } from 'lucide-react';
import type { Chat, Message } from './api';
import { downloadMarkdown } from './markdown-export';

interface Props {
  chat?: Chat;
  messages: Message[];
  selectedResponses: number[];
  mac: boolean;
  openPalette: () => void;
}

export default function ConversationActions({
  chat,
  messages,
  selectedResponses,
  mac,
  openPalette,
}: Props) {
  const selected = messages.filter(
    (message, index) => message.role === 'assistant' && selectedResponses.includes(index),
  );
  return (
    <div className="conversation-actions" aria-label="Conversation actions">
      <button className="secondary-button" onClick={openPalette}>
        Search / {mac ? '⌘ K' : 'Ctrl K'}
      </button>
      <button
        className="conversation-export export-chat"
        aria-label="Export chat"
        title="Export chat as Markdown"
        disabled={!messages.length}
        onClick={() => downloadMarkdown(chat?.title ?? 'Conversation', messages)}
      >
        <Download size={15} aria-hidden="true" />
      </button>
      {selected.length > 0 && (
        <button
          className="conversation-export"
          aria-label={`Export selected (${selected.length})`}
          title={`Export ${selected.length} selected responses as Markdown`}
          onClick={() => downloadMarkdown(chat?.title ?? 'Selected responses', selected)}
        >
          <FileDown size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
