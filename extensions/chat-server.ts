import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatServerService, serviceConfig } from '../scripts/service.ts';

export const actions = ['start', 'status', 'stop', 'restart', 'open', 'logs'] as const;
export default function chatServerExtension(pi: ExtensionAPI) {
  // No process, timer, or service is started at extension load or session startup.
  const root = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '..');
  const service = new ChatServerService(serviceConfig(root));
  let pending = false;
  pi.registerCommand('chat-server', {
    description:
      'Manage the persistent local Chat web server: start, status, stop, restart, open, logs',
    getArgumentCompletions(prefix) {
      const items = actions
        .filter((action) => action.startsWith(prefix))
        .map((action) => ({ value: action, label: action }));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      const action = args.trim() || 'status';
      if (!actions.includes(action as (typeof actions)[number])) {
        ctx.ui.notify(`Usage: /chat-server ${actions.join(' | ')}`, 'warning');
        return;
      }
      if (pending) {
        ctx.ui.notify('A Chat server operation is already in progress.', 'warning');
        return;
      }
      pending = true;
      try {
        switch (action) {
          case 'start':
          case 'restart': {
            ctx.ui.notify(
              `${action === 'start' ? 'Starting' : 'Restarting'} Chat in the background. Building the web app…`,
              'info',
            );
            const state = action === 'start' ? await service.start() : await service.restart();
            ctx.ui.notify(
              `Chat is running at ${state.url} (PID ${state.pid}).\nIt stays running when this terminal closes and starts at login.\nUse /chat-server open to open it, or /chat-server stop to unload it.`,
              'info',
            );
            break;
          }
          case 'status': {
            const state = await service.status();
            ctx.ui.notify(
              `${state.healthy ? `Running (PID ${state.pid})` : state.loaded ? 'Loaded, but not responding' : 'Stopped'} — ${state.url}\nLogs: ${state.logDir}`,
              state.loaded && !state.healthy ? 'warning' : 'info',
            );
            break;
          }
          case 'stop':
            await service.stop();
            ctx.ui.notify(
              'Chat background server stopped. Automatic login startup removed; conversations are preserved.',
              'info',
            );
            break;
          case 'open':
            await service.open();
            break;
          case 'logs':
            ctx.ui.notify(await service.logs(), 'info');
            break;
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        pending = false;
      }
    },
  });
  // Deliberately no session_shutdown cleanup: launchd, not this Pi session, owns the server.
}
