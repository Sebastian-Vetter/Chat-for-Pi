import { SessionManager, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { displayMessages } from './agent.js';
import type { ChatStore } from './store.js';
export class PiSessions {
  private cache: SessionInfo[] = [];
  private expires = 0;
  private pending?: Promise<SessionInfo[]>;
  constructor(
    private store: ChatStore,
    private sessionsDirectory?: string,
  ) {}
  private key(path: string) {
    return createHash('sha256').update(path).digest('hex').slice(0, 32);
  }
  private async all() {
    if (Date.now() < this.expires) return this.cache;
    this.pending ??= SessionManager.listAll(this.sessionsDirectory);
    try {
      this.cache = (await this.pending).sort((a, b) => b.modified.getTime() - a.modified.getTime());
      this.expires = Date.now() + 5000;
      return this.cache;
    } finally {
      this.pending = undefined;
    }
  }
  async list(query = '', offset = 0) {
    const matches = (await this.all()).filter((s) =>
      `${s.name ?? ''} ${s.firstMessage} ${s.cwd}`.toLowerCase().includes(query.toLowerCase()),
    );
    return {
      total: matches.length,
      sessions: matches.slice(offset, offset + 50).map((s) => ({
        key: this.key(s.path),
        title: s.name || s.firstMessage.slice(0, 100) || 'Untitled Pi session',
        cwd: s.cwd,
        modified: s.modified.toISOString(),
        messageCount: s.messageCount,
      })),
    };
  }
  private async find(key: string) {
    const session = (await this.all()).find((s) => this.key(s.path) === key);
    if (!session) throw new Error('Pi session not found. Refresh the session browser.');
    return session;
  }
  async preview(key: string) {
    const info = await this.find(key);
    const manager = SessionManager.open(info.path);
    return {
      title: info.name || info.firstMessage.slice(0, 100) || 'Pi session',
      cwd: info.cwd,
      messages: displayMessages(manager.buildSessionContext().messages),
    };
  }
  async import(key: string) {
    const info = await this.find(key);
    if (!(await stat(info.cwd)).isDirectory())
      throw new Error('This session’s working directory is no longer available.');
    const chat = this.store.create(info.cwd);
    try {
      const directory = join(this.store.directory, 'sessions', chat.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const fork = SessionManager.forkFrom(info.path, info.cwd, directory);
      return this.store.update(chat.id, {
        title: (info.name || info.firstMessage || 'Imported Pi session').slice(0, 100),
        sessionFile: fork.getSessionFile(),
      });
    } catch (error) {
      this.store.delete(chat.id);
      throw error;
    }
  }
}
