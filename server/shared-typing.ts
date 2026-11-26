export interface TypingPerson {
  id: string;
  name: string;
}

// Ephemeral metadata only: no drafts, persistence, agent events, or model calls.
export class SharedTyping {
  private sessions = new Map<string, Map<string, Map<string, number>>>();
  constructor(private now = () => Date.now()) {}
  update(session: string, actor: string, client: unknown, active: unknown) {
    if (
      typeof client !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(client) ||
      typeof active !== 'boolean'
    )
      throw new Error('Invalid typing presence');
    for (const id of this.sessions.keys()) this.actors(id);
    const actors = this.sessions.get(session) ?? new Map<string, Map<string, number>>();
    const leases = actors.get(actor) ?? new Map<string, number>();
    if (active) {
      if (!leases.has(client) && leases.size >= 8) throw new Error('Typing client limit reached');
      leases.set(client, this.now() + 6000);
      actors.set(actor, leases);
      this.sessions.set(session, actors);
    } else {
      leases.delete(client);
      if (!leases.size) actors.delete(actor);
      if (!actors.size) this.sessions.delete(session);
    }
  }
  actors(session: string) {
    const actors = this.sessions.get(session);
    for (const [id, leases] of actors ?? []) {
      for (const [client, expiry] of leases) if (expiry <= this.now()) leases.delete(client);
      if (!leases.size) actors!.delete(id);
    }
    if (!actors?.size) this.sessions.delete(session);
    return [...(actors?.keys() ?? [])];
  }
  clear(session: string, actor?: string) {
    if (!actor) this.sessions.delete(session);
    else {
      this.sessions.get(session)?.delete(actor);
      this.actors(session);
    }
  }
}
