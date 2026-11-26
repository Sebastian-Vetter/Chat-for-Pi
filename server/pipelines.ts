import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatRecord } from './store.js';
import { ActivityLog } from './activity.js';
export interface LocalTask {
  id: string;
  name: string;
  command: string;
  executable: string;
  args: string[];
}
export async function discoverTasks(cwd: string): Promise<LocalTask[]> {
  const tasks: LocalTask[] = [];
  if (existsSync(join(cwd, 'package.json'))) {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    const manager =
      /^pnpm@/.test(pkg.packageManager ?? '') || existsSync(join(cwd, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : /^yarn@/.test(pkg.packageManager ?? '') || existsSync(join(cwd, 'yarn.lock'))
          ? 'yarn'
          : 'npm';
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (
        /^(test|check|lint|typecheck|build)(:|$)/.test(name) &&
        /^[a-zA-Z0-9][\w:.-]*$/.test(name) &&
        !/(watch|--ui|--serve)/i.test(`${name} ${command}`)
      )
        tasks.push({
          id: `package:${name}`,
          name,
          command: `${manager} run ${name}`,
          executable: manager,
          args: ['run', name],
        });
    }
  }
  if (existsSync(join(cwd, 'Cargo.toml')))
    tasks.push({
      id: 'cargo:test',
      name: 'Rust tests',
      command: 'cargo test',
      executable: 'cargo',
      args: ['test'],
    });
  if (existsSync(join(cwd, 'go.mod')))
    tasks.push({
      id: 'go:test',
      name: 'Go tests',
      command: 'go test ./...',
      executable: 'go',
      args: ['test', './...'],
    });
  if (
    existsSync(join(cwd, 'pytest.ini')) ||
    (existsSync(join(cwd, 'pyproject.toml')) &&
      /\[tool\.pytest\./.test(await readFile(join(cwd, 'pyproject.toml'), 'utf8')))
  )
    tasks.push({
      id: 'python:pytest',
      name: 'Python tests',
      command: 'python3 -m pytest',
      executable: 'python3',
      args: ['-m', 'pytest'],
    });
  return tasks;
}
interface Running {
  child: ChildProcess;
  eventId: string;
  cwd: string;
  done: Promise<void>;
}
export class PipelineService {
  private running = new Map<string, Running>();
  private launching = new Set<string>();
  private cancelled = new Set<string>();
  private closing = false;
  constructor(
    private log: ActivityLog,
    private notify: (record: ChatRecord) => void,
    private authorize?: (record: ChatRecord, task: LocalTask) => Promise<void>,
  ) {}
  busy(chatId: string) {
    return this.running.has(chatId) || this.launching.has(chatId);
  }
  async start(record: ChatRecord, taskId: string) {
    if (this.closing) throw new Error('The server is shutting down.');
    if (this.busy(record.id))
      throw new Error('A local test run is already active in this conversation.');
    this.launching.add(record.id);
    this.cancelled.delete(record.id);
    try {
      const cwd = await realpath(record.cwd);
      const task = (await discoverTasks(cwd)).find((task) => task.id === taskId);
      if (!task)
        throw new Error('This test command is not configured in the workspace. Refresh Tests.');
      if ([...this.running.values()].some((run) => run.cwd === cwd))
        throw new Error('A local test run is already active in this workspace.');
      if (this.closing || this.cancelled.has(record.id)) throw new Error('Test run cancelled.');
      await this.authorize?.(record, task);
      if (this.closing || this.cancelled.has(record.id)) throw new Error('Test run cancelled.');
      if ([...this.running.values()].some((run) => run.cwd === cwd))
        throw new Error('A local test run is already active in this workspace.');
      const eventId = this.log.start(record.id, 'test', task.name, `$ ${task.command}\n`);
      let output = `$ ${task.command}\n`,
        finished = false,
        stopped = false;
      const child = spawn(task.executable, task.args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let complete!: () => void;
      const done = new Promise<void>((resolve) => {
        complete = resolve;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const publish = () => {
        timer = undefined;
        this.log.update(record.id, eventId, { detail: output });
        this.notify(record);
      };
      const append = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')).slice(
          -64000,
        );
        if (!timer) timer = setTimeout(publish, 180);
      };
      const finish = (code: number | null, error?: string) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (error) output += `\n${error}`;
        const status = stopped ? 'stopped' : code === 0 ? 'passed' : 'failed';
        this.log.update(record.id, eventId, {
          status,
          detail: `${output}\n${stopped ? 'Stopped by user' : `Exit code: ${code ?? 'terminated'}`}`,
        });
        this.running.delete(record.id);
        this.notify(record);
        complete();
      };
      child.on('error', (error) => finish(null, error.message));
      child.on('close', (code) => finish(code));
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      // Store stop intent on the process without exposing arbitrary PID controls to the API.
      child.once('chat-stop', () => {
        stopped = true;
      });
      this.running.set(record.id, { child, eventId, cwd, done });
      this.notify(record);
      return eventId;
    } finally {
      this.launching.delete(record.id);
      this.cancelled.delete(record.id);
    }
  }
  async stop(chatId: string) {
    if (this.launching.has(chatId)) this.cancelled.add(chatId);
    const active = this.running.get(chatId);
    if (!active) return;
    active.child.emit('chat-stop');
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && active.child.pid)
          process.kill(-active.child.pid, signal);
        else active.child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    kill('SIGTERM');
    const force = setTimeout(() => kill('SIGKILL'), 3000);
    try {
      await active.done;
    } finally {
      clearTimeout(force);
    }
  }
  async shutdown() {
    this.closing = true;
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}
