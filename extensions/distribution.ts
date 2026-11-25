import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { ChatServerService, serviceConfig } from '../scripts/service.ts';
import { installApplication, installationPaths } from '../scripts/install-app.ts';
import { UpdateChecker, RELEASES_URL } from '../scripts/updates.ts';

export default function distribution(pi: ExtensionAPI) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = existsSync(join(packageRoot, 'app', 'package.json')) ? join(packageRoot, 'app') : packageRoot;
  const version: string = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  const paths = installationPaths();
  const service = new ChatServerService({ ...serviceConfig(paths.root), dataDir: paths.data, workspace: homedir() });
  const checker = new UpdateChecker(version, process.env.CHAT_UPDATE_CHECK !== '0');
  const actions = ['install', 'start', 'status', 'stop', 'restart', 'open', 'logs', 'updates'];
  let pending = false;
  pi.registerCommand('chat-server', {
    description: 'Install/manage Chat for Pi and check releases: install, start, status, stop, restart, open, logs, updates',
    getArgumentCompletions: prefix => actions.filter(action => action.startsWith(prefix)).map(action => ({ value: action, label: action })),
    async handler(args, ctx) {
      const action = args.trim() || 'status';
      if (!actions.includes(action)) { ctx.ui.notify(`Usage: /chat-server ${actions.join(' | ')}`, 'warning'); return; }
      if (pending) { ctx.ui.notify('A Chat operation is already in progress.', 'warning'); return; }
      pending = true;
      try {
        if (action === 'install') {
          if (!ctx.hasUI) throw new Error('Installation requires an interactive confirmation in Pi.');
          if (process.platform !== 'darwin') throw new Error('The Pi-managed background installer currently supports macOS. Use the standalone app download on Linux/Windows.');
          if ((await service.status()).loaded) throw new Error('Finish active runs and use /chat-server stop before installing. No service was stopped.');
          if (!(await ctx.ui.confirm(`Install Chat for Pi ${version}?`, `Copy trusted application code to ${paths.root} and run npm ci (including dependency install scripts) and npm run build? Internet access and Node.js 22.19+ are required. Data stays in ${paths.data}. No server will start or stop automatically.`))) return;
          ctx.ui.notify('Installing dependencies and building Chat. This can take several minutes…', 'info');
          const result = await installApplication(source, homedir());
          ctx.ui.notify(`Installed Chat ${result.version}. Use /chat-server start, then /chat-server open.\nData: ${result.data}${result.previous ? `\nPrevious application retained for rollback: ${result.previous}` : ''}`, 'info');
        } else if (action === 'updates') {
          const status = await checker.check(true);
          ctx.ui.notify(status.status === 'available' ? `Chat ${status.latest} is available.\n${status.releaseUrl}\npi install git:github.com/Sebastian-Vetter/Chat-for-Pi@v${status.latest}\nThen /reload, finish active runs, /chat-server stop, /chat-server install and /chat-server start.\n${status.notes ?? ''}` : `${status.message ?? `Package ${version} is up to date.`}\n${RELEASES_URL}`, status.status === 'unavailable' ? 'warning' : 'info');
        } else if (action === 'start' || action === 'restart') {
          if (!existsSync(join(paths.root, 'package.json'))) throw new Error('Run /chat-server install first.');
          if (action === 'restart' && (!ctx.hasUI || !(await ctx.ui.confirm('Restart Chat?', 'This interrupts active web runs and configured tests. Continue?')))) return;
          const state = action === 'start' ? await service.start() : await service.restart();
          ctx.ui.notify(`Chat is running at ${state.url}. It survives terminal closure and starts at login.`, 'info');
        } else if (action === 'stop') {
          if (!ctx.hasUI || !(await ctx.ui.confirm('Stop Chat?', 'This interrupts active web runs and configured tests and removes login startup. History is preserved. Continue?'))) return;
          await service.stop(); ctx.ui.notify('Chat stopped. History preserved.', 'info');
        } else if (action === 'status') {
          const state = await service.status();
          const installed = existsSync(join(paths.root, 'package.json')) ? JSON.parse(readFileSync(join(paths.root, 'package.json'), 'utf8')).version : 'not installed';
          ctx.ui.notify(`Pi package: ${version} · App: ${installed}\n${state.healthy ? 'Running' : state.loaded ? 'Loaded, unhealthy' : 'Stopped'} — ${state.url}\nData: ${paths.data}`, 'info');
        } else if (action === 'open') await service.open();
        else if (action === 'logs') ctx.ui.notify(await service.logs(), 'info');
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
      finally { pending = false; }
    },
  });
  // No network, installation, timers or services at extension load. Web UI checks releases.
}
