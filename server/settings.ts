import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

export interface QueueSettings {
  queuesEnabled: boolean;
  revision: number;
}

/** Installation-wide queue policy, separate from browser-only display preferences. */
export class AppSettings {
  private value: QueueSettings = { queuesEnabled: true, revision: 0 };
  private listeners = new Set<(settings: QueueSettings) => void>();
  constructor(private path: string) {
    if (!existsSync(path)) return;
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (
      typeof saved?.queuesEnabled !== 'boolean' ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 0
    )
      throw new Error('Invalid app settings; restore settings.json before starting the server');
    this.value = { queuesEnabled: saved.queuesEnabled, revision: saved.revision };
  }
  read(): QueueSettings {
    return { ...this.value };
  }
  update(queuesEnabled: boolean) {
    if (queuesEnabled === this.value.queuesEnabled) return this.read();
    const next = { queuesEnabled, revision: this.value.revision + 1 };
    writeFileSync(`${this.path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
    this.value = next;
    this.listeners.forEach((listener) => listener(this.read()));
    return this.read();
  }
  subscribe(listener: (settings: QueueSettings) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
