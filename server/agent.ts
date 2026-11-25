import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatRecord, ChatStore } from './store.js';

export interface DisplayMessage { role: string; text: string; toolName?: string; isError?: boolean }
export function displayMessages(messages: readonly unknown[], streamingMessage?: unknown): DisplayMessage[] {
  return [...messages, ...(streamingMessage ? [streamingMessage] : [])].flatMap(raw => {
    const message = raw as { role: string; content?: string | { type: string; text?: string }[]; toolName?: string; isError?: boolean; errorMessage?: string };
    if (!['user', 'assistant', 'toolResult'].includes(message.role)) return [];
    const text = typeof message.content === 'string' ? message.content : (message.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
    return text || message.role === 'toolResult' || message.errorMessage
      ? [{ role: message.role, text: text || message.errorMessage || '', toolName: message.toolName, isError: message.isError || !!message.errorMessage }] : [];
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
  constructor(private store: ChatStore) {}
  busy(id: string) { return this.running.has(id); }
  snapshot(record: ChatRecord) {
    const session = this.sessions.get(record.id);
    const messages = session?.messages ?? (record.sessionFile && existsSync(record.sessionFile) ? SessionManager.open(record.sessionFile).buildSessionContext().messages : []);
    return { chat: record, messages: displayMessages(messages, session?.state.streamingMessage), busy: this.busy(record.id), tool: this.tools.get(record.id), error: this.errors.get(record.id), model: session?.model ? `${session.model.provider}/${session.model.id}` : undefined };
  }
  subscribe(id: string, fn: (event: unknown) => void) {
    const group = this.listeners.get(id) ?? new Set(); group.add(fn); this.listeners.set(id, group);
    return () => { group.delete(fn); if (!group.size) this.listeners.delete(id); };
  }
  private publish(record: ChatRecord) { const snapshot = this.snapshot(record); this.listeners.get(record.id)?.forEach(fn => fn(snapshot)); }
  private async session(record: ChatRecord): Promise<AgentSession> {
    const cached = this.sessions.get(record.id); if (cached) return cached;
    const pending = this.loading.get(record.id); if (pending) return pending;
    const promise = this.create(record); this.loading.set(record.id, promise);
    try { return await promise; } finally { this.loading.delete(record.id); }
  }
  private async create(record: ChatRecord) {
    const sessionDir = join(this.store.directory, 'sessions', record.id);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    const sessionManager = record.sessionFile && existsSync(record.sessionFile)
      ? SessionManager.open(record.sessionFile) : SessionManager.create(record.cwd, sessionDir);
    // TUI extensions require interactive UI bindings; do not execute them in this web host.
    const resourceLoader = new DefaultResourceLoader({ cwd: record.cwd, agentDir: getAgentDir(), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
    await resourceLoader.reload();
    const { session } = await createAgentSession({ cwd: record.cwd, sessionManager, resourceLoader, modelRuntime: await this.runtime });
    this.sessions.set(record.id, session);
    if (session.sessionFile) this.store.update(record.id, { sessionFile: session.sessionFile });
    session.subscribe(event => {
      if (event.type === 'tool_execution_start') this.tools.set(record.id, event.toolName);
      if (event.type === 'tool_execution_end') this.tools.delete(record.id);
      this.publish(record);
    });
    return session;
  }
  async prompt(record: ChatRecord, text: string, modelKey?: string) {
    if (this.busy(record.id)) throw new Error('This chat is already running');
    this.running.add(record.id); this.errors.delete(record.id); this.publish(record);
    try {
      const session = await this.session(record);
      if (modelKey) {
        const runtime = await this.runtime;
        const model = (await runtime.getAvailable()).find(m => `${m.provider}/${m.id}` === modelKey);
        if (!model) throw new Error('Model is not available. Check your Pi credentials.');
        await session.setModel(model);
      }
      if (record.title === 'New chat') this.store.update(record.id, { title: text.replace(/\s+/g, ' ').slice(0, 70) });
      await session.prompt(text);
    } catch (error) {
      this.errors.set(record.id, error instanceof Error ? error.message : String(error));
    } finally {
      this.running.delete(record.id); this.tools.delete(record.id);
      this.store.update(record.id, {}); this.publish(record);
    }
  }
  async abort(id: string) {
    const pending = this.loading.get(id); if (pending) await pending;
    await this.sessions.get(id)?.abort();
  }
  dispose(id: string) { this.sessions.get(id)?.dispose(); this.sessions.delete(id); this.errors.delete(id); }
  async shutdown() {
    await Promise.allSettled([...this.loading.values()]);
    await Promise.allSettled([...this.sessions.values()].map(s => s.abort()));
    for (const session of this.sessions.values()) session.dispose();
  }
}
