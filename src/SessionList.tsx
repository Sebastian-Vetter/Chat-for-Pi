import { Fragment, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Search,
  Trash2,
  Pin,
  Folder,
} from 'lucide-react';
import type { Chat } from './api';

const VISIBILITY_KEY = 'pi-chat-sessions-hidden';

// Owned by App so closing the mobile sidebar does not reset search/archive state.
export function useSessionList() {
  const [search, setSearch] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [groupBy, setGroupBy] = useState(() => {
    const stored = localStorage.getItem('pi-chat-session-grouping');
    return stored === 'project' || stored === 'folder' ? stored : 'flat';
  });
  const [hidden, setHidden] = useState(() => localStorage.getItem(VISIBILITY_KEY) === 'true');

  function updateHidden(value: boolean) {
    setHidden(value);
    localStorage.setItem(VISIBILITY_KEY, String(value));
  }

  function toggleArchive() {
    setArchiveOpen((value) => !value);
    setSearch('');
    updateHidden(false);
  }

  return {
    search,
    setSearch,
    groupBy,
    setGroupBy: (value: string) => {
      setGroupBy(value);
      localStorage.setItem('pi-chat-session-grouping', value);
    },
    archiveOpen,
    hidden,
    toggleArchive,
    toggleHidden: () => updateHidden(!hidden),
  };
}

interface SessionListProps {
  chats: Chat[];
  active: string | null;
  running: Record<string, boolean>;
  view: ReturnType<typeof useSessionList>;
  select: (id: string) => void;
  archive: (chat: Chat) => Promise<void>;
  rename: (chat: Chat) => Promise<void>;
  remove: (chat: Chat) => Promise<void>;
  pin: (chat: Chat) => void;
  folder: (chat: Chat) => void;
}

function emptyMessage(search: string, archiveOpen: boolean) {
  if (search) return archiveOpen ? 'No matching archived sessions.' : 'No matching conversations.';
  if (archiveOpen) return 'No archived sessions.';
  return 'A little space for your next big idea. Start a conversation.';
}

export default function SessionList({
  chats,
  active,
  running,
  view,
  select,
  archive,
  rename,
  remove,
  pin,
  folder,
}: SessionListProps) {
  const { search, setSearch, archiveOpen, hidden, toggleArchive, toggleHidden } = view;
  const query = search.toLowerCase();
  const visibleChats = chats.filter(
    (chat) =>
      Boolean(chat.archived) === archiveOpen &&
      `${chat.title} ${chat.cwd}`.toLowerCase().includes(query),
  );
  const groupLabel = (chat: Chat) =>
    chat.pinned
      ? 'Pinned'
      : view.groupBy === 'project'
        ? `Project · ${chat.cwd}`
        : view.groupBy === 'folder'
          ? `Folder · ${chat.folder || 'Unfiled'}`
          : '';
  visibleChats.sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      groupLabel(a).localeCompare(groupLabel(b)) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const archiveCount = chats.filter((chat) => chat.archived).length;

  return (
    <>
      <div className="session-list-controls">
        <button
          aria-label={archiveOpen ? 'Show active sessions' : 'Open session archive'}
          aria-pressed={archiveOpen}
          onClick={toggleArchive}
        >
          <Archive size={14} />
          {archiveOpen ? 'Back to sessions' : 'Session archive'} <span>{archiveCount}</span>
        </button>
        <button
          aria-label={hidden ? 'Show session list' : 'Hide session list'}
          aria-expanded={!hidden}
          onClick={toggleHidden}
        >
          <ChevronDown size={15} style={{ transform: hidden ? 'rotate(-90deg)' : undefined }} />
        </button>
      </div>
      {!hidden && (
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search chats"
            placeholder="Search conversations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      {!hidden && (
        <label className="session-grouping">
          Group sessions
          <select
            aria-label="Group sessions"
            value={view.groupBy}
            onChange={(event) => view.setGroupBy(event.target.value)}
          >
            <option value="flat">Recent</option>
            <option value="project">By project</option>
            <option value="folder">By folder</option>
          </select>
        </label>
      )}
      <nav className="chat-list" aria-label={archiveOpen ? 'Archived sessions' : 'Conversations'}>
        {!hidden &&
          (visibleChats.length ? (
            visibleChats.map((chat, index) => (
              <Fragment key={chat.id}>
                {groupLabel(chat) &&
                  (index === 0 || groupLabel(visibleChats[index - 1]) !== groupLabel(chat)) && (
                    <div className="session-group-heading" title={groupLabel(chat)}>
                      {groupLabel(chat)}
                    </div>
                  )}
                <div className={`chat-item ${active === chat.id ? 'active' : ''}`}>
                  <button className="chat-select" title={chat.cwd} onClick={() => select(chat.id)}>
                    {running[chat.id] ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : chat.pinned ? (
                      <Pin size={15} />
                    ) : (
                      <MessageSquare size={15} />
                    )}
                    <span>{chat.title}</span>
                  </button>
                  <div className="chat-item-actions">
                    <button
                      className="icon-button"
                      aria-label={`${chat.pinned ? 'Unpin' : 'Pin'} ${chat.title}`}
                      onClick={() => pin(chat)}
                    >
                      <Pin size={13} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Move ${chat.title} to folder`}
                      onClick={() => folder(chat)}
                    >
                      <Folder size={13} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${chat.archived ? 'Restore' : 'Archive'} ${chat.title}`}
                      onClick={() => void archive(chat)}
                    >
                      {chat.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Rename ${chat.title}`}
                      onClick={() => void rename(chat)}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${chat.title}`}
                      onClick={() => void remove(chat)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </Fragment>
            ))
          ) : (
            <div className="empty-history">{emptyMessage(search, archiveOpen)}</div>
          ))}
      </nav>
    </>
  );
}
