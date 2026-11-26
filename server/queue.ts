import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
export interface QueuedPrompt {
  id: string;
  text: string;
  model?: string;
  actorId?: string;
  actorGrant?: string;
  timestamp: string;
}
interface QueueState {
  items: QueuedPrompt[];
  paused: boolean;
  inflight?: QueuedPrompt;
}
export class PromptQueues {
  private states = new Map<string, QueueState>();
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  state(id: string) {
    if (!this.states.has(id)) {
      const path = join(this.directory, `${id}.json`);
      const state: QueueState = existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf8'))
        : { items: [], paused: false };
      if (state.inflight) state.items.unshift(state.inflight);
      state.inflight = undefined;
      if (state.items.length) state.paused = true;
      this.states.set(id, state);
    }
    return this.states.get(id)!;
  }
  add(id: string, text: string, model?: string, actorId?: string, actorGrant?: string) {
    const state = this.state(id);
    if (state.items.length >= 20) throw new Error('Queue limit reached (20 pending prompts).');
    const prompt = {
      id: randomUUID(),
      text,
      model,
      ...(actorId ? { actorId, actorGrant } : {}),
      timestamp: new Date().toISOString(),
    };
    state.items.push(prompt);
    this.save(id);
    return prompt;
  }
  pause(id: string, paused: boolean) {
    this.state(id).paused = paused;
    this.save(id);
  }
  take(id: string) {
    const state = this.state(id);
    if (state.paused || state.inflight) return undefined;
    const prompt = state.items.shift();
    state.inflight = prompt;
    this.save(id);
    return prompt;
  }
  complete(id: string) {
    this.state(id).inflight = undefined;
    this.save(id);
  }
  remove(id: string, promptId: string) {
    const state = this.state(id);
    state.items = state.items.filter((item) => item.id !== promptId);
    this.save(id);
  }
  delete(id: string) {
    this.states.delete(id);
    rmSync(join(this.directory, `${id}.json`), { force: true });
  }
  private save(id: string) {
    const path = join(this.directory, `${id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify(this.state(id)), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
}
