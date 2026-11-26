import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatRecord, ChatStore } from './store.js';
import { conversationInstructions } from './instructions.js';
import { ActivityLog } from './activity.js';
import { PromptQueues } from './queue.js';
import { AppSettings } from './settings.js';
import { Subagents } from './subagents.js';
import { Approvals } from './approvals.js';
import { approvedTools, planTool } from './work-tools.js';

export interface DisplayMessage {
  role: string;
  text: string;
  toolName?: string;
  isError?: boolean;
}
export function displayMessages(
  messages: readonly unknown[],
  streamingMessage?: unknown,
): DisplayMessage[] {
  return [...messages, ...(streamingMessage ? [streamingMessage] : [])].flatMap((raw) => {
    const message = raw as {
      role: string;
      content?: string | { type: string; text?: string }[];
      toolName?: string;
      isError?: boolean;
      errorMessage?: string;
    };
    if (!['user', 'assistant', 'toolResult'].includes(message.role)) return [];
    const text =
      typeof message.content === 'string'
        ? message.content
        : (message.content ?? [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n');
    return text || message.role === 'toolResult' || message.errorMessage
      ? [
          {
            role: message.role,
            text: text || message.errorMessage || '',
            toolName: message.toolName,
            isError: message.isError || !!message.errorMessage,
          },
        ]
      : [];
  });
}
export class AgentService {
  readonly runtime = ModelRuntime.create();
  private sessions = new Map<string, AgentSession>();
  private loading = new Map<string, Promise<AgentSession>>();
  private running = new Set<string>();
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  private errors = new Map<string, string>();
  private tools = new Map<string, string>();
  private globalListeners = new Set<(summary: unknown) => void>();
  private summaries = new Map<string, string>();
  private closing = false;
  readonly queues: PromptQueues;
  readonly settings: AppSettings;
  private subagents: Subagents;
  readonly approvals: Approvals;
  constructor(
    private store: ChatStore,
    readonly activity = new ActivityLog(join(store.directory, 'activity')),
  ) {
    this.queues = new PromptQueues(join(store.directory, 'queues'));
    this.settings = new AppSettings(join(store.directory, 'settings.json'));
    this.approvals = new Approvals(
      (record) => this.publish(record),
      (record, request, approved) => {
        const id = this.activity.start(
          record.id,
          'agent',
          `Approval · ${request.tool}`,
          `${approved ? 'Approved once' : 'Rejected / expired / cancelled'}\n${JSON.stringify(request.input, null, 2).slice(0, 10000)}`,
        );
        this.activity.update(record.id, id, { status: approved ? 'passed' : 'stopped' });
        if (!approved && request.tool !== 'configured_test') {
          this.queues.pause(record.id, true);
          this.errors.set(
            record.id,
            'An action was rejected, cancelled, or expired. Review the proposal before continuing.',
          );
        }
      },
    );
    this.subagents = new Subagents(this.runtime, activity, (record) => this.publish(record));
  }
  summariesList() {
    return this.store.list().map((chat) => ({
      id: chat.id,
      title: chat.title,
      busy: this.busy(chat.id),
      error: this.errors.get(chat.id),
    }));
  }
  subscribeAll(fn: (summary: unknown) => void) {
    this.globalListeners.add(fn);
    return () => {
      this.globalListeners.delete(fn);
    };
  }
  setQueuesEnabled(enabled: boolean) {
    if (this.settings.read().queuesEnabled === enabled) return this.settings.read();
    // Disable first so even a failed pause/save cannot launch another queued prompt.
    if (!enabled) this.settings.update(false);
    for (const record of this.store.list()) {
      if (!this.queues.state(record.id).items.length) continue;
      this.queues.pause(record.id, true);
      this.publish(record);
    }
    // Re-enabling never resumes saved prompts without a separate per-chat decision.
    if (enabled) this.settings.update(true);
    return this.settings.read();
  }
  enqueue(record: ChatRecord, text: string, model?: string) {
    if (!this.settings.read().queuesEnabled)
      throw new Error('Prompt queues are disabled. Enable them in Settings first.');
    if (this.closing) throw new Error('Server is shutting down');
    this.queues.add(record.id, text, model);
    this.publish(record);
    this.drain(record);
  }
  pauseQueue(record: ChatRecord, paused: boolean) {
    if (!paused && !this.settings.read().queuesEnabled)
      throw new Error('Prompt queues are disabled. Enable them in Settings first.');
    this.queues.pause(record.id, paused);
    this.publish(record);
    if (!paused) this.drain(record);
  }
  private drain(record: ChatRecord) {
    if (
      this.closing ||
      !this.settings.read().queuesEnabled ||
      this.busy(record.id) ||
      !this.store.get(record.id)
    )
      return;
    const next = this.queues.take(record.id);
    if (!next) return;
    void this.prompt(record, next.text, next.model)
      .finally(() => {
        this.queues.complete(record.id);
        this.publish(record);
        this.drain(record);
      })
      .catch((error) => console.error('Queued prompt failed:', error));
  }
  busy(id: string) {
    return this.running.has(id);
  }
  instructions(record: ChatRecord) {
    return conversationInstructions(
      record.cwd,
      this.sessions.get(record.id)?.resourceLoader.getAgentsFiles().agentsFiles,
    );
  }
  snapshot(record: ChatRecord) {
    const session = this.sessions.get(record.id);
    const messages =
      session?.messages ??
      (record.sessionFile && existsSync(record.sessionFile)
        ? SessionManager.open(record.sessionFile).buildSessionContext().messages
        : []);
    return {
      chat: record,
      contextUsage: session?.getContextUsage() ?? record.contextUsage,
      contextStale: !session,
      approvals: this.approvals.list(record.id),
      queue: this.queues.state(record.id).items,
      queuePaused: this.queues.state(record.id).paused,
      events: this.activity.list(record.id),
      messages: displayMessages(messages, session?.state.streamingMessage),
      busy: this.busy(record.id),
      tool: this.tools.get(record.id),
      error: this.errors.get(record.id),
      model: session?.model ? `${session.model.provider}/${session.model.id}` : record.modelName,
    };
  }
  subscribe(id: string, fn: (event: unknown) => void) {
    const group = this.listeners.get(id) ?? new Set();
    group.add(fn);
    this.listeners.set(id, group);
    return () => {
      group.delete(fn);
      if (!group.size) this.listeners.delete(id);
    };
  }
  publish(record: ChatRecord) {
    const snapshot = this.snapshot(record);
    this.listeners.get(record.id)?.forEach((fn) => fn(snapshot));
    const summary = {
      id: record.id,
      title: record.title,
      busy: this.busy(record.id),
      error: this.errors.get(record.id),
    };
    const serialized = JSON.stringify(summary);
    if (this.summaries.get(record.id) !== serialized) {
      this.summaries.set(record.id, serialized);
      this.globalListeners.forEach((fn) => fn(summary));
    }
  }
  private async session(record: ChatRecord): Promise<AgentSession> {
    const cached = this.sessions.get(record.id);
    if (cached) return cached;
    const pending = this.loading.get(record.id);
    if (pending) return pending;
    const promise = this.create(record);
    this.loading.set(record.id, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(record.id);
    }
  }
  private async create(record: ChatRecord) {
    const sessionDir = join(this.store.directory, 'sessions', record.id);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    const sessionManager =
      record.sessionFile && existsSync(record.sessionFile)
        ? SessionManager.open(record.sessionFile)
        : SessionManager.create(record.cwd, sessionDir);
    // TUI extensions require interactive UI bindings; do not execute them in this web host.
    const resourceLoader = new DefaultResourceLoader({
      cwd: record.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: record.cwd,
      sessionManager,
      resourceLoader,
      modelRuntime: await this.runtime,
      tools: ['read', 'grep', 'find', 'ls', 'bash', 'powershell', 'edit', 'write', 'update_plan'],
      customTools: [
        ...approvedTools(record, this.approvals),
        planTool(record, this.store, () => this.publish(record)),
        this.subagents.tool(record, () => this.sessions.get(record.id)),
      ],
    });
    session.setActiveToolsByName(
      session
        .getActiveToolNames()
        .filter((name) => name !== 'subagent')
        .concat(record.subagentsEnabled ? ['subagent'] : []),
    );
    this.sessions.set(record.id, session);
    if (session.sessionFile) this.store.update(record.id, { sessionFile: session.sessionFile });
    session.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        this.tools.set(record.id, event.toolName);
        const args = event.args as Record<string, unknown>;
        this.activity.start(
          record.id,
          'tool',
          event.toolName,
          JSON.stringify(args, null, 2),
          `${session.sessionId}:${event.toolCallId}`,
        );
      }
      if (event.type === 'tool_execution_end') {
        this.tools.delete(record.id);
        this.activity.update(record.id, `${session.sessionId}:${event.toolCallId}`, {
          status: event.isError ? 'failed' : 'passed',
          durationMs: event.durationMs,
        });
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const id = this.activity.start(
          record.id,
          'agent',
          'Assistant response',
          displayMessages([event.message])
            .map((m) => m.text)
            .join('\n'),
        );
        this.activity.update(record.id, id, {
          status:
            event.message.stopReason === 'aborted'
              ? 'stopped'
              : event.message.errorMessage
                ? 'failed'
                : 'passed',
        });
      }
      this.publish(record);
    });
    return session;
  }
  async prompt(record: ChatRecord, text: string, modelKey?: string) {
    if (this.closing) throw new Error('The server is shutting down');
    if (this.busy(record.id)) throw new Error('This chat is already running');
    const runId = this.activity.start(record.id, 'agent', 'Pi coding run', text);
    this.running.add(record.id);
    this.errors.delete(record.id);
    this.publish(record);
    try {
      const session = await this.session(record);
      if (modelKey) {
        const runtime = await this.runtime;
        const model = (await runtime.getAvailable()).find(
          (m) => `${m.provider}/${m.id}` === modelKey,
        );
        if (!model) throw new Error('Model is not available. Check your Pi credentials.');
        await session.setModel(model);
      }
      if (record.title === 'New chat')
        this.store.update(record.id, { title: text.replace(/\s+/g, ' ').slice(0, 70) });
      if (text.startsWith('/')) await this.command(record, session, text);
      else await session.prompt(text);
      const last = text.startsWith('/')
        ? undefined
        : session.messages.findLast((message) => message.role === 'assistant');
      this.activity.update(record.id, runId, {
        status: this.errors.has(record.id)
          ? 'stopped'
          : last?.role === 'assistant' && last.stopReason === 'aborted'
            ? 'stopped'
            : last?.role === 'assistant' && last.errorMessage
              ? 'failed'
              : 'passed',
      });
      if (last?.role === 'assistant' && (last.stopReason === 'aborted' || last.errorMessage))
        this.queues.pause(record.id, true);
    } catch (error) {
      this.activity.update(record.id, runId, { status: 'failed' });
      this.queues.pause(record.id, true);
      this.errors.set(record.id, error instanceof Error ? error.message : String(error));
    } finally {
      this.running.delete(record.id);
      this.tools.delete(record.id);
      const session = this.sessions.get(record.id);
      this.store.update(record.id, {
        contextUsage: session?.getContextUsage(),
        modelName: session?.model
          ? `${session.model.provider}/${session.model.id}`
          : record.modelName,
      });
      this.publish(record);
      queueMicrotask(() => this.drain(record));
    }
  }
  private async command(record: ChatRecord, session: AgentSession, text: string) {
    const [command, ...parts] = text.split(/\s+/);
    const args = parts.join(' ');
    let result: string;
    if (command === '/subagent') {
      if (args && !['on', 'off', 'status'].includes(args))
        throw new Error(
          'Usage: /subagent [on|off|status]. Enable, then describe your research task.',
        );
      if (args !== 'status') this.store.update(record.id, { subagentsEnabled: args !== 'off' });
      session.setActiveToolsByName(
        session
          .getActiveToolNames()
          .filter((name) => name !== 'subagent')
          .concat(record.subagentsEnabled ? ['subagent'] : []),
      );
      result = `Research subagents ${record.subagentsEnabled ? 'enabled' : 'disabled'}. ${record.subagentsEnabled ? 'Pi can now delegate focused research via the subagent tool. Children use the current model with read-only tools and additional provider usage.' : ''}`;
    } else if (command === '/compact') {
      await session.compact(args || undefined);
      result = 'Conversation compacted.';
    } else if (command === '/model') {
      const runtime = await this.runtime;
      const models = await runtime.getAvailable();
      if (args) {
        const model = models.find((m) => `${m.provider}/${m.id}` === args);
        if (!model) throw new Error('Use /model provider/model-id from the model picker.');
        await session.setModel(model);
      }
      result = `Model: ${session.model ? `${session.model.provider}/${session.model.id}` : 'none'}`;
    } else if (command === '/thinking') {
      if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(args))
        throw new Error('Usage: /thinking off|minimal|low|medium|high|xhigh');
      session.setThinkingLevel(args as Parameters<AgentSession['setThinkingLevel']>[0]);
      result = `Thinking level: ${session.thinkingLevel}`;
    } else
      throw new Error(
        `Unsupported web command: ${command}. Open Commands for supported commands and terminal alternatives.`,
      );
    const id = this.activity.start(record.id, 'agent', command, result);
    this.activity.update(record.id, id, { status: 'passed' });
  }
  async abort(id: string) {
    this.approvals.cancel(id);
    this.queues.pause(id, true);
    const pending = this.loading.get(id);
    if (pending) await pending;
    await this.sessions.get(id)?.abort();
    const record = this.store.get(id);
    if (record) this.publish(record);
  }
  dispose(id: string) {
    this.approvals.cancel(id);
    this.sessions.get(id)?.dispose();
    this.sessions.delete(id);
    this.errors.delete(id);
  }
  async shutdown() {
    this.closing = true;
    this.approvals.shutdown();
    await Promise.allSettled([...this.loading.values()]);
    await Promise.allSettled([...this.sessions.values()].map((s) => s.abort()));
    for (const session of this.sessions.values()) session.dispose();
  }
}
