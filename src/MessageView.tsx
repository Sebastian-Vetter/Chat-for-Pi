import { useState } from 'react';
import { Check, ChevronDown, Copy, Terminal } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from './api';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copyMessage() {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {
        // Clipboard access may be denied by browser permissions.
      });
  }

  return (
    <button
      className="icon-button"
      aria-label="Copy message"
      title={copied ? 'Copied' : 'Copy'}
      onClick={copyMessage}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

export default function MessageView({
  message,
  selected,
  toggleSelected,
}: {
  message: Message;
  selected?: boolean;
  toggleSelected?: () => void;
}) {
  if (message.role === 'toolResult') {
    return (
      <details className={`tool-result ${message.isError ? 'failed' : ''}`}>
        <summary>
          <Terminal size={14} />
          <span>
            {message.toolName ?? 'Tool'} {message.isError ? 'failed' : 'output'}
          </span>
          <ChevronDown size={13} />
        </summary>
        <pre>{message.text || 'Completed without output.'}</pre>
      </details>
    );
  }

  const isUser = message.role === 'user';

  return (
    <article className={`message ${isUser ? 'user-message' : 'assistant-message'}`}>
      {!isUser && (
        <div className="message-author">
          <span className="pi-avatar">π</span>Pi <span>CODING AGENT</span>
        </div>
      )}
      <div className={`message-body ${message.isError ? 'failed' : ''}`}>
        {isUser ? (
          <p>{message.text}</p>
        ) : (
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
            {message.text}
          </Markdown>
        )}
      </div>
      <div className="message-actions">
        <CopyButton text={message.text} />
        {!isUser && toggleSelected && (
          <label className="export-selection">
            <input
              type="checkbox"
              aria-label="Select response for export"
              checked={!!selected}
              onChange={toggleSelected}
            />
            Export
          </label>
        )}
      </div>
    </article>
  );
}
