import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { ChatServerService, serviceConfig } from '../scripts/service.ts';
import { installApplication, installationPaths } from '../scripts/install-app.ts';
import { UpdateChecker } from '../scripts/updates.ts';
import { piInstallCommand, RELEASES_URL } from '../scripts/release-info.ts';

type CommandHandler = (context: ExtensionCommandContext) => Promise<void>;

function installedVersion(root: string) {
  const manifest = join(root, 'package.json');
  return existsSync(manifest)
    ? (JSON.parse(readFileSync(manifest, 'utf8')).version as string)
    : 'not installed';
}

export default function distribution(pi: ExtensionAPI) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = existsSync(join(packageRoot, 'app', 'package.json'))
    ? join(packageRoot, 'app')
    : packageRoot;
  const version = installedVersion(packageRoot);
  const paths = installationPaths();
  const service = new ChatServerService({
    ...serviceConfig(paths.root),
    dataDir: paths.data,
    workspace: homedir(),
  });
  const checker = new UpdateChecker(version, process.env.CHAT_UPDATE_CHECK !== '0');
  let pending = false;

  async function install(context: ExtensionCommandContext) {
    if (!context.hasUI) throw new Error('Installation requires an interactive confirmation in Pi.');
    if (process.platform !== 'darwin')
      throw new Error(
        'The Pi-managed background installer currently supports macOS. Use the standalone app download on Linux/Windows.',
      );
    if ((await service.status()).loaded)
      throw new Error(
        'Finish active runs and use /chat-server stop before installing. No service was stopped.',
      );

    const confirmed = await context.ui.confirm(
      `Install Chat for Pi ${version}?`,
      `Copy trusted application code to ${paths.root} and run npm ci (including dependency install scripts) and npm run build? Internet access and Node.js 22.19+ are required. Data stays in ${paths.data}. No server will start or stop automatically.`,
    );
    if (!confirmed) return;

    context.ui.notify(
      'Installing dependencies and building Chat. This can take several minutes…',
      'info',
    );
    const result = await installApplication(source, homedir());
    const rollback = result.previous
      ? `\nPrevious application retained for rollback: ${result.previous}`
      : '';
    context.ui.notify(
      `Installed Chat ${result.version}. Use /chat-server start, then /chat-server open.\nData: ${result.data}${rollback}`,
      'info',
    );
  }

  async function checkUpdates(context: ExtensionCommandContext) {
    const update = await checker.check(true);
    const message =
      update.status === 'available' && update.latest
        ? `Chat ${update.latest} is available.\n${update.releaseUrl}\n${piInstallCommand(update.latest)}\nThen /reload, finish active runs, /chat-server stop, /chat-server install and /chat-server start.\n${update.notes ?? ''}`
        : `${update.message ?? `Package ${version} is up to date.`}\n${RELEASES_URL}`;

    context.ui.notify(message, update.status === 'unavailable' ? 'warning' : 'info');
  }

  async function start(context: ExtensionCommandContext, restart = false) {
    if (!existsSync(join(paths.root, 'package.json')))
      throw new Error('Run /chat-server install first.');
    if (
      restart &&
      (!context.hasUI ||
        !(await context.ui.confirm(
          'Restart Chat?',
          'This interrupts active web runs and configured tests. Continue?',
        )))
    )
      return;

    const state = restart ? await service.restart() : await service.start();
    context.ui.notify(
      `Chat is running at ${state.url}. It survives terminal closure and starts at login.`,
      'info',
    );
  }

  async function stop(context: ExtensionCommandContext) {
    if (!context.hasUI) return;
    const confirmed = await context.ui.confirm(
      'Stop Chat?',
      'This interrupts active web runs and configured tests and removes login startup. History is preserved. Continue?',
    );
    if (!confirmed) return;

    await service.stop();
    context.ui.notify('Chat stopped. History preserved.', 'info');
  }

  async function showStatus(context: ExtensionCommandContext) {
    const state = await service.status();
    const health = state.healthy ? 'Running' : state.loaded ? 'Loaded, unhealthy' : 'Stopped';
    context.ui.notify(
      `Pi package: ${version} · App: ${installedVersion(paths.root)}\n${health} — ${state.url}\nData: ${paths.data}`,
      'info',
    );
  }

  const handlers: Record<string, CommandHandler> = {
    install,
    start: (context) => start(context),
    status: showStatus,
    stop,
    restart: (context) => start(context, true),
    open: () => service.open(),
    logs: async (context) => {
      context.ui.notify(await service.logs(), 'info');
    },
    updates: checkUpdates,
  };
  const actions = Object.keys(handlers);

  pi.registerCommand('chat-server', {
    description:
      'Install/manage Chat for Pi and check releases: install, start, status, stop, restart, open, logs, updates',
    getArgumentCompletions: (prefix) =>
      actions
        .filter((action) => action.startsWith(prefix))
        .map((action) => ({ value: action, label: action })),
    async handler(args, context) {
      const action = args.trim() || 'status';
      if (!Object.hasOwn(handlers, action)) {
        context.ui.notify(`Usage: /chat-server ${actions.join(' | ')}`, 'warning');
        return;
      }
      if (pending) {
        context.ui.notify('A Chat operation is already in progress.', 'warning');
        return;
      }

      pending = true;
      try {
        await handlers[action](context);
      } catch (error) {
        context.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        pending = false;
      }
    },
  });
  // No network, installation, timers or services at extension load. Web UI checks releases.
}
