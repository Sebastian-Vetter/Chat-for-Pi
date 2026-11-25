import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from './api';
import { version } from '../package.json';
import type { UpdateStatus } from '../scripts/updates';
import { piInstallCommand, REPOSITORY_URL, RELEASES_URL } from '../scripts/release-info';
export default function Updates({
  open,
  show,
  close,
}: {
  open: boolean;
  show: () => void;
  close: () => void;
}) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [checking, setChecking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function check(manual = false) {
    setChecking(true);
    try {
      setStatus(
        await api<UpdateStatus>(
          manual ? '/updates/check' : '/updates',
          manual ? { method: 'POST', body: '{}' } : undefined,
        ),
      );
    } catch {
      setStatus({
        current: version,
        status: 'unavailable',
        message: 'Could not reach the local update checker. Your chats are unaffected.',
      });
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const available = status?.status === 'available';
  const install = piInstallCommand(status?.latest ?? 'X.Y.Z');
  return (
    <>
      {available && (
        <div className="update-notice" role="status">
          <span>Version {status.latest} available</span>
          <button onClick={show}>Release notes & update</button>
        </div>
      )}
      {open && (
        <dialog
          ref={dialog}
          className="workspace-dialog updates-dialog"
          aria-label="Updates and releases"
          onCancel={close}
        >
          <div className="dialog-heading">
            <h2>Updates & releases</h2>
            <button className="secondary-button" onClick={close}>
              Close
            </button>
          </div>
          <p>
            Installed web app: <strong>v{version}</strong>
            {status?.current && status.current !== version && (
              <>
                {' '}
                · Running server: <strong>v{status.current}</strong>. Reload the browser after
                updating the server.
              </>
            )}
          </p>
          <p role="status">
            {checking
              ? 'Checking releases…'
              : available
                ? `Version ${status.latest} is available.`
                : status?.status === 'current'
                  ? `No newer stable release available${status.latest ? ` (latest: ${status.latest})` : ''}.`
                  : (status?.message ?? 'Checking releases…')}
          </p>
          {status?.checkedAt && (
            <small>Last checked: {new Date(status.checkedAt).toLocaleString()}</small>
          )}
          <p>
            Checks contact GitHub for public release metadata only, without prompts, workspace
            paths, or credentials. Checks are cached for one hour; manual checks are limited to once
            per minute. Set CHAT_UPDATE_CHECK=0 on the server to disable them.
          </p>
          <button
            className="secondary-button"
            disabled={checking || status?.status === 'disabled'}
            onClick={() => void check(true)}
          >
            Check for updates
          </button>
          {status?.notes && (
            <section className="release-notes">
              <h3>Release notes · {status.latest}</h3>
              <Markdown
                components={{
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                  img: () => null,
                }}
              >
                {status.notes}
              </Markdown>
            </section>
          )}
          <h3>Install / update the Pi package</h3>
          {!status?.latest && (
            <p>
              Choose a published release on GitHub and replace X.Y.Z with its version. A local
              version is not necessarily published.
            </p>
          )}
          <pre>{install}</pre>
          <ol>
            <li>
              Finish active web runs and configured tests. Updates never stop them automatically.
            </li>
            <li>
              Run the command above in your terminal, then <code>/reload</code> in Pi.
            </li>
            <li>
              If Chat is running, explicitly confirm <code>/chat-server stop</code>.
            </li>
            <li>
              Run <code>/chat-server install</code> and review the installation confirmation. It
              installs dependencies and builds the app.
            </li>
            <li>
              Run <code>/chat-server start</code>, then <code>/chat-server open</code> and reload
              the browser.
            </li>
          </ol>
          <p>
            Pi-managed installation currently supports macOS. Its data stays outside application
            code in ~/.local/share/pi-chat/data. Existing Git checkouts keep their own data: update
            those with git pull --ff-only and rebuild instead of switching installations. Back up
            data before changing installation methods.
          </p>
          <p>
            <a href={status?.releaseUrl ?? RELEASES_URL} target="_blank" rel="noreferrer">
              GitHub releases
            </a>
            {status?.downloadUrl && (
              <>
                {' '}
                ·{' '}
                <a href={status.downloadUrl} target="_blank" rel="noreferrer">
                  Download Pi package
                </a>
              </>
            )}{' '}
            ·{' '}
            <a href={`${REPOSITORY_URL}/blob/dev/README.md`} target="_blank" rel="noreferrer">
              Installation guide
            </a>
          </p>
          <p>
            No automatic installation or restart. Version-pinned Pi packages only change when you
            explicitly install a newer tag.
          </p>
        </dialog>
      )}
    </>
  );
}
