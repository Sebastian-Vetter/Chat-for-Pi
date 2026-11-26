import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface PlanStep {
  text: string;
  status: 'pending' | 'running' | 'done';
}

export interface ChatRecord {
  id: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  sessionFile?: string;
  archived?: boolean;
  shared?: boolean;
  pinned?: boolean;
  folder?: string;
  approvalMode?: boolean;
  plan?: PlanStep[];
  planRevision?: number;
  subagentsEnabled?: boolean;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  modelName?: string;
}
export class ChatStore {
  private records: ChatRecord[];
  private file: string;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'chats.json');
    this.records = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
  }
  list() {
    return [...this.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string) {
    return this.records.find((record) => record.id === id);
  }
  create(cwd: string, shared = false) {
    const now = new Date().toISOString();
    const record: ChatRecord = {
      id: randomUUID(),
      ...(shared ? { shared: true } : {}),
      title: 'New chat',
      cwd,
      createdAt: now,
      updatedAt: now,
    };
    this.records.push(record);
    this.save();
    return record;
  }
  update(
    id: string,
    values: Partial<
      Pick<
        ChatRecord,
        | 'title'
        | 'sessionFile'
        | 'contextUsage'
        | 'modelName'
        | 'subagentsEnabled'
        | 'archived'
        | 'pinned'
        | 'folder'
        | 'approvalMode'
        | 'plan'
      >
    >,
  ) {
    const record = this.get(id);
    if (!record) throw new Error('Chat not found');
    const planRevision = Object.hasOwn(values, 'plan')
      ? (record.planRevision ?? 0) + 1
      : record.planRevision;
    Object.assign(record, values, {
      ...(planRevision !== undefined ? { planRevision } : {}),
      updatedAt: new Date().toISOString(),
    });
    this.save();
    return record;
  }
  delete(id: string) {
    this.records = this.records.filter((record) => record.id !== id);
    this.save();
  }
  private save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.records, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
