import { randomUUID } from 'node:crypto';
import { ACCESS_MARKER, SharedService, type SharedTarget, type SignedRequest } from './shared.js';

type State = 'pending' | 'approved' | 'denied' | 'expired' | 'unavailable';
interface Outgoing {
  id: string;
  target: SharedTarget;
  title: string;
  state: State;
  remoteId?: string;
  error?: string;
  busy?: boolean;
}
export class SharedAccessClient {
  private entries: Outgoing[] = [];
  private polling?: Promise<void>;
  constructor(
    private shared: SharedService,
    private call: (target: SharedTarget, request: SignedRequest) => Promise<unknown>,
  ) {}
  list() {
    return this.entries.map(({ id, title, state, remoteId, error, target }) => ({
      id,
      title,
      state,
      remoteId,
      error,
      ownerId: target.ownerId,
      ownerName: target.owner.name,
      sessionId: target.sessionId,
    }));
  }
  async request(target: SharedTarget, title: string) {
    this.shared.assertKnownOwner(target);
    let entry = this.entries.find(
      (entry) =>
        entry.target.ownerId === target.ownerId && entry.target.sessionId === target.sessionId,
    );
    if (entry && entry.target.owner.publicKey !== target.owner.publicKey)
      throw new Error('Owner identity key changed; verify the owner first');
    if (!entry) {
      if (this.entries.length >= 20)
        this.entries = this.entries.filter((entry) => entry.state === 'pending');
      if (this.entries.length >= 20) throw new Error('Too many pending requests');
      entry = { id: randomUUID(), target, title, state: 'pending' };
      this.entries.push(entry);
    }
    entry.target = target;
    entry.state = 'pending';
    entry.error = undefined;
    await this.check(entry, 'access-request');
    return this.list();
  }
  async poll() {
    if (this.polling) return this.polling;
    const pending = this.entries.filter((entry) => entry.state === 'pending');
    this.polling = (async () => {
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, pending.length) }, async () => {
          while (index < pending.length) await this.check(pending[index++], 'access-status');
        }),
      );
    })();
    try {
      await this.polling;
    } finally {
      this.polling = undefined;
    }
  }
  private async check(entry: Outgoing, operation: string) {
    if (entry.busy) return;
    entry.busy = true;
    try {
      this.shared.assertKnownOwner(entry.target);
      const result = (await this.call(
        entry.target,
        this.shared.signed(entry.target.sessionId, ACCESS_MARKER, operation, {}),
      )) as {
        state: State;
        token?: string;
        title?: string;
        ownerId?: string;
        owner?: { publicKey: string };
      };
      if (result?.state === 'approved') {
        if (
          result.ownerId !== entry.target.ownerId ||
          result.owner?.publicKey !== entry.target.owner.publicKey ||
          typeof result.token !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(result.token) ||
          typeof result.title !== 'string' ||
          result.title.length > 120
        )
          throw new Error('Invalid owner approval');
        const joined = this.shared.addRemote(entry.target, result.token, result.title);
        entry.remoteId = joined.id;
      } else if (!['pending', 'denied', 'expired'].includes(result?.state))
        throw new Error('Invalid access response');
      entry.state = result.state;
      entry.error = undefined;
    } catch (error) {
      entry.state = 'unavailable';
      entry.error = error instanceof Error ? error.message : 'Owner unavailable';
    } finally {
      entry.busy = false;
    }
  }
}
