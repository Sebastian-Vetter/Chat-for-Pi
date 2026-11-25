import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

export interface CommandResult { code: number; stdout: string; stderr: string }
export type Run = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;
interface Health { app: string; serviceId?: string | null; pid: number }
export interface ServiceConfig {
  root: string; node: string; home: string; uid: number; label: string; target: string; dataDir?: string; workspace?: string;
  plist: string; logDir: string; url: string; port: number;
}
export function serviceConfig(root: string, home = homedir(), node = process.execPath, uid = process.getuid?.() ?? -1): ServiceConfig {
  root = resolve(root);
  const id = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const label = `de.aptcode.pi-chat.${id}`;
  return { root, home, node, uid, label, target: `gui/${uid}/${label}`, port: 3001, url: 'http://127.0.0.1:3001',
    plist: join(home, 'Library', 'LaunchAgents', `${label}.plist`), logDir: join(home, 'Library', 'Logs', 'Pi Chat', id) };
}
function xml(value: string) { return value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!); }
export function servicePlist(config: ServiceConfig, env: NodeJS.ProcessEnv = process.env) {
  // Only non-secret shell configuration is persisted. Never serialize provider keys or PI_SESSION_*.
  const environment: Record<string, string> = {
    HOME: config.home,
    PATH: [dirname(config.node), env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'].join(':'),
    SHELL: env.SHELL ?? '/bin/zsh', LANG: env.LANG ?? 'en_US.UTF-8',
    PORT: String(config.port), CHAT_DATA_DIR: config.dataDir ?? join(config.root, '.data'),
    CHAT_WORKSPACE: config.workspace ?? dirname(config.root), CHAT_SERVICE_ID: config.label,
    ...(env.CHAT_UPDATE_CHECK === '0' ? { CHAT_UPDATE_CHECK: '0' } : {}),
  };
  const args = [config.node, '--import', pathToFileURL(join(config.root, 'node_modules/tsx/dist/loader.mjs')).href, join(config.root, 'server/index.ts')];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(config.label)}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(config.root)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ExitTimeOut</key><integer>30</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(config.logDir, 'server.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(config.logDir, 'error.log'))}</string>
</dict></plist>
`;
}
export const run: Run = (command, args, cwd) => new Promise(resolveResult => {
  execFile(command, args, { cwd, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolveResult({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr: stderr || (error?.message ?? '') });
  });
});
async function probe(url: string): Promise<Health | undefined> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return undefined;
    return await response.json() as Health;
  } catch { return undefined; }
}
async function portFree(port: number) {
  return new Promise<boolean>(resolveResult => {
    const socket = createServer();
    socket.once('error', () => resolveResult(false));
    socket.listen(port, '127.0.0.1', () => socket.close(() => resolveResult(true)));
  });
}
interface Dependencies {
  run: Run; probe: typeof probe; portFree: typeof portFree; sleep: (ms: number) => Promise<void>;
  platform: string; env: NodeJS.ProcessEnv;
}
export class ChatServerService {
  private deps: Dependencies;
  constructor(readonly config: ServiceConfig, dependencies: Partial<Dependencies> = {}) {
    this.deps = { run, probe, portFree, sleep: ms => new Promise(r => setTimeout(r, ms)), platform: process.platform, env: process.env, ...dependencies };
  }
  private checkPlatform() {
    if (this.deps.platform !== 'darwin' || this.config.uid < 0) throw new Error('The background service currently requires a logged-in macOS user (launchd).');
  }
  private async loaded() {
    const result = await this.deps.run('/bin/launchctl', ['print', this.config.target]);
    if (result.code === 0) return true;
    if (/could not find service|no such process/i.test(result.stderr)) return false;
    throw new Error(`Cannot query launchd: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  private async checked(command: string, args: string[], cwd?: string) {
    const result = await this.deps.run(command, args, cwd);
    if (result.code !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim().slice(-4000)}`);
    return result;
  }
  async status() {
    this.checkPlatform();
    const loaded = await this.loaded();
    const health = await this.deps.probe(this.config.url);
    const healthy = !!health && health.app === 'pi-chat' && health.serviceId === this.config.label;
    return { loaded, healthy: loaded && healthy, pid: loaded && healthy ? health.pid : undefined,
      url: this.config.url, installed: existsSync(this.config.plist), logDir: this.config.logDir };
  }
  async start() {
    this.checkPlatform();
    const state = await this.status();
    if (state.healthy) return { ...state, alreadyRunning: true };
    if (state.loaded) throw new Error(`The service is loaded but not healthy. Check ${this.config.logDir}, then use /chat-server restart.`);
    if (!(await this.deps.portFree(this.config.port))) throw new Error(`Port ${this.config.port} is already in use. Stop the existing npm run dev / npm start server first; no processes were killed.`);
    for (const file of ['node_modules/tsx/dist/loader.mjs', 'node_modules/typescript/bin/tsc', 'node_modules/vite/bin/vite.js', 'server/index.ts']) {
      if (!existsSync(join(this.config.root, file))) throw new Error(`Missing ${file}. Run npm install in ${this.config.root} first.`);
    }
    // Build once before registering the service; no Vite watcher or terminal is needed at runtime.
    await this.checked(this.config.node, [join(this.config.root, 'node_modules/typescript/bin/tsc'), '--noEmit'], this.config.root);
    await this.checked(this.config.node, [join(this.config.root, 'node_modules/vite/bin/vite.js'), 'build'], this.config.root);
    await mkdir(dirname(this.config.plist), { recursive: true });
    await mkdir(this.config.logDir, { recursive: true, mode: 0o700 });
    await writeFile(this.config.plist, servicePlist(this.config, this.deps.env), { mode: 0o600 });
    try {
      await this.checked('/usr/bin/plutil', ['-lint', this.config.plist]);
      await this.checked('/bin/launchctl', ['bootstrap', `gui/${this.config.uid}`, this.config.plist]);
    } catch (error) {
      // Do not leave a broken login job behind after a failed start.
      await rm(this.config.plist, { force: true });
      throw error;
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      const health = await this.deps.probe(this.config.url);
      if (health?.app === 'pi-chat' && health.serviceId === this.config.label) return { loaded: true, healthy: true, alreadyRunning: false, pid: health.pid, url: this.config.url, logDir: this.config.logDir };
      await this.deps.sleep(250);
    }
    await this.stop();
    throw new Error(`Service did not become ready and was unloaded. Check ${this.config.logDir}. macOS may require permission to access Documents for ${this.config.node}.`);
  }
  async stop() {
    this.checkPlatform();
    // Stop only our launchd job. Never kill arbitrary processes listening on the port.
    if (await this.loaded()) await this.checked('/bin/launchctl', ['bootout', this.config.target]);
    await rm(this.config.plist, { force: true });
    for (let attempt = 0; attempt < 60; attempt++) {
      const health = await this.deps.probe(this.config.url);
      if (health?.serviceId !== this.config.label) return;
      await this.deps.sleep(250);
    }
    throw new Error('The job was unloaded, but its server is still shutting down. Wait before starting it again.');
  }
  async restart() { await this.stop(); return this.start(); }
  async logs() {
    const sections = await Promise.all(['server.log', 'error.log'].map(async file => {
      try {
        // Read only the tail, even when a long-lived service has produced a large log.
        const { open } = await import('node:fs/promises');
        const handle = await open(join(this.config.logDir, file), 'r');
        try {
          const size = (await handle.stat()).size;
          const buffer = Buffer.alloc(Math.min(size, 16 * 1024));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
          const text = buffer.subarray(0, bytesRead).toString('utf8').split('\n').slice(-35).join('\n');
          return `${file}:\n${text || '(empty)'}`;
        } finally { await handle.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `${file}: (not created yet)`;
        throw error;
      }
    }));
    return `Logs: ${this.config.logDir}\n\n${sections.join('\n\n')}`;
  }
  async open() {
    const state = await this.status();
    if (!state.healthy) throw new Error('Start the background service first with /chat-server start.');
    await this.checked('/usr/bin/open', [this.config.url]);
  }
}
