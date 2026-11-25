import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export interface ActivityEvent {
  id: string;
  type: 'agent' | 'tool' | 'test';
  label: string;
  status: 'running' | 'passed' | 'failed' | 'stopped' | 'interrupted';
  timestamp: string;
  finishedAt?: string;
  durationMs?: number;
  detail?: string;
}
export class ActivityLog {
  private cache = new Map<string, ActivityEvent[]>();
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  list(chatId: string) {
    if (!this.cache.has(chatId)) {
      const path = join(this.directory, `${chatId}.json`);
      const events: ActivityEvent[] = existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf8'))
        : [];
      for (const event of events)
        if (event.status === 'running') {
          event.status = 'interrupted';
          event.detail = (event.detail ?? '') + '\nServer stopped before this event completed.';
        }
      this.cache.set(chatId, events.slice(-300));
    }
    return this.cache.get(chatId)!;
  }
  start(
    chatId: string,
    type: ActivityEvent['type'],
    label: string,
    detail = '',
    id: string = randomUUID(),
  ) {
    const event: ActivityEvent = {
      id,
      type,
      label,
      detail: detail.slice(-64000),
      status: 'running',
      timestamp: new Date().toISOString(),
    };
    const events = this.list(chatId);
    events.push(event);
    this.cache.set(chatId, events.slice(-300));
    this.save(chatId);
    return event.id;
  }
  update(
    chatId: string,
    id: string,
    values: Partial<Pick<ActivityEvent, 'status' | 'detail' | 'durationMs'>>,
  ) {
    const event = this.list(chatId).find((e) => e.id === id);
    if (!event) return;
    Object.assign(event, values);
    if (values.detail) event.detail = values.detail.slice(-64000);
    if (values.status && values.status !== 'running') {
      event.finishedAt = new Date().toISOString();
      event.durationMs ??= Date.now() - Date.parse(event.timestamp);
    }
    this.save(chatId);
  }
  delete(chatId: string) {
    this.cache.delete(chatId);
    rmSync(join(this.directory, `${chatId}.json`), { force: true });
  }
  private save(chatId: string) {
    const path = join(this.directory, `${chatId}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify(this.list(chatId)), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
}
