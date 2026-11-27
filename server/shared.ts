import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AgentService } from './agent.js';
import type { ChatStore } from './store.js';
import { InstallationIdentity, proof, validPeer, type PeerIdentity } from './shared-identity.js';
import { digest, emptyProject, overlaps, SharedFiles } from './shared-files.js';
import { SharedTyping, type TypingPerson } from './shared-typing.js';

export type SharedRole = 'reader' | 'writer';
interface Member extends PeerIdentity {
  role: SharedRole;
  tokenHash: string;
  grantId: string;
  blocked?: boolean;
  admitted?: boolean;
}
interface AccessRequest {
  id: string;
  peer: PeerIdentity;
  createdAt: string;
  state: 'pending' | 'denied';
}
interface Share {
  id: string;
  root: string;
  enabled: boolean;
  invites: Partial<Record<SharedRole, string>>;
  members: Member[];
  requests?: AccessRequest[];
}
export const ACCESS_MARKER = 'pi-chat-access-v1'.padEnd(43, '_');
export interface SharedTarget {
  endpoint: string;
  certificate: string;
  sessionId: string;
  ownerId: string;
  owner: PeerIdentity;
}
export interface SharedInvite extends SharedTarget {
  version: 1;
  token: string;
  ownerProof: string;
}
export function invitationMessage(invite: Omit<SharedInvite, 'ownerProof'>) {
  return JSON.stringify([
    'pi-chat-lan-v1',
    invite.endpoint,
    digest(invite.certificate),
    invite.sessionId,
    invite.ownerId,
    invite.owner.id,
    invite.owner.name,
    invite.owner.publicKey,
    digest(invite.token),
  ]);
}
export interface RemoteShare {
  id: string;
  invite: SharedTarget;
  token: string;
  title: string;
}
export interface SignedRequest {
  payload: string;
  signature: string;
}
export interface SharedRequest {
  sessionId: string;
  peer: PeerIdentity;
  nonce: string;
  at: number;
  capability: string;
  operation: string;
  data: Record<string, unknown>;
}
export function secret() {
  return randomBytes(32).toString('base64url');
}
function matches(hash: string | undefined, token: string) {
  return !!hash && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(digest(token), 'hex'));
}

export class SharedService {
  readonly identity: InstallationIdentity;
  private file: string;
  private state: { shares: Share[]; remotes: RemoteShare[] };
  private nonces = new Map<string, number>();
  private typing = new SharedTyping();
  constructor(
    readonly store: ChatStore,
    private agents: AgentService,
  ) {
    this.identity = new InstallationIdentity(store.directory);
    this.file = join(store.directory, 'shared.json');
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : { shares: [], remotes: [] };
    agents.sharedWriterAllowed = (id, actor, grant) => this.canWrite(id, actor, grant);
  }
  private save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  private share(id: string) {
    const share = this.state.shares.find((item) => item.id === id);
    if (!share || !this.store.get(id)?.shared) throw new Error('Shared session not found');
    return share;
  }
  private named() {
    if (!this.identity.public().name) throw new Error('Choose your display name first');
  }
  protectedFolder(folder: string) {
    return this.state.shares.some((share) => overlaps(share.root, folder));
  }
  create(folder: string, title: string, trustWriters: boolean) {
    this.named();
    if (trustWriters !== true)
      throw new Error('Confirm that writers may execute local agent tools');
    if (
      typeof folder !== 'string' ||
      !folder.trim() ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 120
    )
      throw new Error('Choose a project folder and a session name');
    const root = emptyProject(
      folder,
      this.state.shares.map((share) => share.root),
    );
    if (this.store.list().some((chat) => chat.cwd === root))
      throw new Error('This folder already belongs to a conversation; choose a new empty folder');
    const chat = this.store.create(root, true);
    try {
      this.store.update(chat.id, { title: title.trim() });
      this.state.shares.push({ id: chat.id, root, enabled: false, invites: {}, members: [] });
      this.save();
      return chat;
    } catch (error) {
      this.state.shares = this.state.shares.filter((item) => item.id !== chat.id);
      this.store.delete(chat.id);
      throw error;
    }
  }
  list() {
    return {
      owner: this.identity.public(),
      owned: this.state.shares.flatMap((share) => {
        const chat = this.store.get(share.id);
        return chat
          ? [
              {
                id: share.id,
                title: chat.title,
                enabled: share.enabled,
                role: 'owner' as const,
                requests: (share.requests ?? []).filter((request) => request.state === 'pending'),
                members: share.members.map(
                  ({ tokenHash: _secret, grantId: _grant, ...member }) => member,
                ),
              },
            ]
          : [];
      }),
      joined: this.state.remotes.map(({ id, title, invite }) => ({
        id,
        title,
        ownerId: invite.ownerId,
      })),
    };
  }
  advertisements() {
    return this.state.shares
      .filter((share) => share.enabled && this.store.get(share.id))
      .slice(0, 20)
      .map((share) => ({ id: share.id, title: this.store.get(share.id)!.title }));
  }
  access(id: string, enabled: boolean) {
    this.named();
    const share = this.share(id);
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    share.enabled = enabled;
    if (!enabled) {
      this.typing.clear(id);
      share.requests = [];
      share.invites = {};
      share.members.forEach((member) => {
        member.tokenHash = '';
        member.admitted = false;
        member.grantId = randomUUID();
      });
    }
    this.save();
    this.agents.publish(this.store.get(id)!);
    return this.list();
  }
  invitation(id: string, role: SharedRole) {
    const share = this.share(id);
    if (!share.enabled || !['reader', 'writer'].includes(role))
      throw new Error('Enable sharing and choose reader or writer');
    const token = secret();
    share.invites[role] = digest(token);
    this.save();
    return token;
  }
  member(id: string, memberId: string, role: SharedRole | 'removed') {
    const member = this.share(id).members.find((item) => item.id === memberId);
    if (!member || !['reader', 'writer', 'removed'].includes(role))
      throw new Error('Invalid participant or role');
    if (role === 'removed') {
      member.blocked = true;
      member.tokenHash = '';
    } else {
      member.role = role;
      member.blocked = false;
    }
    member.admitted = role !== 'removed';
    this.share(id).requests = (this.share(id).requests ?? []).filter(
      (request) => request.peer.id !== memberId,
    );
    this.typing.clear(id, memberId);
    member.grantId = randomUUID();
    this.share(id).invites = {};
    this.save();
    return this.list();
  }
  removeMember(id: string, memberId: string) {
    const share = this.share(id);
    if (!share.members.some((member) => member.id === memberId))
      throw new Error('Participant not found');
    share.members = share.members.filter((member) => member.id !== memberId);
    share.requests = (share.requests ?? []).filter((request) => request.peer.id !== memberId);
    share.invites = {};
    this.typing.clear(id, memberId);
    this.save();
    return this.list();
  }
  canWrite(id: string, actor: string, grant?: string) {
    const share = this.state.shares.find((item) => item.id === id);
    return (
      !!share?.enabled &&
      share.members.some(
        (member) =>
          member.id === actor &&
          member.role === 'writer' &&
          !member.blocked &&
          !!member.tokenHash &&
          !!grant &&
          member.grantId === grant,
      )
    );
  }
  typingPeople(id: string): TypingPerson[] {
    const share = this.share(id);
    if (!share.enabled) {
      this.typing.clear(id);
      return [];
    }
    const owner = this.identity.public();
    return this.typing.actors(id).flatMap((actor) => {
      if (actor === owner.id) return [{ id: owner.id, name: owner.name }];
      const member = share.members.find(
        (member) =>
          member.id === actor && member.role === 'writer' && !member.blocked && !!member.tokenHash,
      );
      return member ? [{ id: member.id, name: member.name }] : [];
    });
  }
  ownerTyping(id: string, client: unknown, active: unknown) {
    const share = this.share(id);
    if (!share.enabled && active !== false) throw new Error('Sharing is off');
    this.typing.update(id, this.identity.public().id, client, active);
    return { ok: true };
  }
  files(id: string) {
    return new SharedFiles(this.share(id).root);
  }
  ownerText(text: string) {
    return /^\/(?:compact|model|thinking|subagent)(?:\s|$)/.test(text)
      ? text
      : `[Owner · ${this.identity.public().name}]\n${text}`;
  }
  remote(id: string) {
    const remote = this.state.remotes.find((item) => item.id === id);
    if (!remote) throw new Error('Joined session not found');
    return remote;
  }
  assertKnownOwner(invite: SharedTarget) {
    const known = this.state.remotes.find((item) => item.invite.ownerId === invite.ownerId);
    if (known && known.invite.owner?.publicKey !== invite.owner.publicKey)
      throw new Error(
        'Owner identity key changed. Verify with the owner and remove the old joined session before pairing again.',
      );
  }
  addRemote(invite: SharedTarget, token: string, title: string) {
    this.assertKnownOwner(invite);
    let remote = this.state.remotes.find(
      (item) =>
        item.invite.ownerId === invite.ownerId && item.invite.sessionId === invite.sessionId,
    );
    const { token: _invitationSecret, ...target } = invite as SharedTarget & { token?: string };
    if (remote) Object.assign(remote, { invite: target, token, title });
    else {
      remote = { id: randomUUID(), invite: target, token, title };
      this.state.remotes.push(remote);
    }
    this.save();
    return { id: remote.id, title };
  }
  forgetRemote(id: string) {
    this.state.remotes = this.state.remotes.filter((item) => item.id !== id);
    this.save();
    return { ok: true };
  }
  acceptsCapability(token: string) {
    return this.state.shares.some(
      (share) =>
        !!this.store.get(share.id) &&
        share.enabled &&
        (Object.values(share.invites).some((hash) => matches(hash, token)) ||
          share.members.some((member) => !member.blocked && matches(member.tokenHash, token))),
    );
  }
  signed(
    sessionId: string,
    token: string,
    operation: string,
    data: Record<string, unknown>,
  ): SignedRequest {
    this.named();
    const payload = JSON.stringify({
      sessionId,
      peer: this.identity.public(),
      nonce: secret(),
      at: Date.now(),
      capability: digest(token),
      operation,
      data,
    });
    return { payload, signature: this.identity.sign(payload) };
  }
  decideAccess(id: string, requestId: string, role: unknown) {
    const share = this.share(id);
    if (!share.enabled) throw new Error('Sharing is off');
    if (role !== null && role !== 'reader' && role !== 'writer')
      throw new Error('Choose reader, writer or rejection');
    const request = share.requests?.find(
      (request) => request.id === requestId && request.state === 'pending',
    );
    if (!request) throw new Error('Request is no longer pending');
    if (role === null) request.state = 'denied';
    else {
      let member = share.members.find((member) => member.id === request.peer.id);
      if (member && member.publicKey !== request.peer.publicKey)
        throw new Error('Participant identity changed');
      if (!member && share.members.length >= 50) throw new Error('Participant limit reached');
      const grant: Member = {
        ...request.peer,
        role,
        tokenHash: '',
        grantId: randomUUID(),
        admitted: true,
        blocked: false,
      };
      if (member) Object.assign(member, grant);
      else {
        member = grant;
        share.members.push(member);
      }
      share.requests = share.requests!.filter((item) => item.id !== requestId);
      this.typing.clear(id, member.id);
    }
    this.save();
    return this.list();
  }
  accessRPC(envelope: SignedRequest): unknown {
    const { request, nonceKey } = this.verify(envelope, ACCESS_MARKER);
    if (!['access-request', 'access-status'].includes(request.operation))
      throw new Error('Unsupported access operation');
    const share = this.share(request.sessionId);
    if (!share.enabled || request.peer.id === this.identity.public().id)
      throw new Error('Sharing is off or invalid participant');
    const member = share.members.find((member) => member.id === request.peer.id);
    if (member && member.publicKey !== request.peer.publicKey)
      throw new Error('Participant identity changed');
    if (member?.blocked) return { state: 'denied' };
    if (member && member.admitted !== false && (member.admitted || member.tokenHash)) {
      this.nonces.set(nonceKey, Date.now() + 120000);
      const token = secret();
      member.tokenHash = digest(token);
      member.admitted = true;
      member.name = request.peer.name;
      this.save();
      return {
        state: 'approved',
        token,
        title: this.store.get(share.id)!.title,
        ownerId: this.identity.public().id,
        owner: this.identity.public(),
      };
    }
    const requests = share.requests ?? [];
    let pending = requests.find(
      (item) => item.peer.id === request.peer.id || item.peer.publicKey === request.peer.publicKey,
    );
    if (
      pending &&
      (pending.peer.id !== request.peer.id || pending.peer.publicKey !== request.peer.publicKey)
    )
      throw new Error('Request identity changed');
    if (!pending && request.operation === 'access-request') {
      if (
        requests.length >= 100 ||
        requests.filter((item) => item.state === 'pending').length >= 25
      )
        throw new Error('Access request limit reached');
      pending = {
        id: randomUUID(),
        peer: request.peer,
        createdAt: new Date().toISOString(),
        state: 'pending',
      };
      requests.push(pending);
      share.requests = requests;
      this.save();
    }
    if (pending) this.nonces.set(nonceKey, Date.now() + 120000);
    return { state: pending?.state ?? 'expired' };
  }
  private verify(envelope: SignedRequest, token: string) {
    if (
      !envelope ||
      typeof envelope.payload !== 'string' ||
      typeof token !== 'string' ||
      token.length !== 43
    )
      throw new Error('Invalid authentication');
    const request = JSON.parse(envelope.payload) as SharedRequest;
    validPeer(request.peer);
    request.peer = {
      id: request.peer.id,
      name: request.peer.name,
      publicKey: request.peer.publicKey,
    };
    if (
      !proof(request.peer.publicKey, envelope.payload, envelope.signature) ||
      request.capability !== digest(token) ||
      !Number.isSafeInteger(request.at) ||
      Math.abs(Date.now() - request.at) > 60000 ||
      typeof request.nonce !== 'string' ||
      request.nonce.length !== 43
    )
      throw new Error('Invalid or expired participant proof');
    for (const [key, expiry] of this.nonces) if (expiry < Date.now()) this.nonces.delete(key);
    const nonceKey = `${request.peer.id}:${request.nonce}`;
    if (this.nonces.has(nonceKey) || this.nonces.size >= 10000)
      throw new Error('Replayed request or request limit reached');
    return { request, nonceKey };
  }
  rpc(envelope: SignedRequest, token: string): unknown {
    const { request, nonceKey } = this.verify(envelope, token);
    const share = this.share(request.sessionId);
    if (!share.enabled || request.peer.id === this.identity.public().id)
      throw new Error('Sharing is off or invalid participant');
    if (request.operation === 'join') {
      const role = (['reader', 'writer'] as const).find((role) =>
        matches(share.invites[role], token),
      );
      if (!role) throw new Error('Invitation expired or revoked');
      let member = share.members.find((member) => member.id === request.peer.id);
      if (member && (member.publicKey !== request.peer.publicKey || member.blocked))
        throw new Error('Participant identity changed or access was revoked');
      if (!member && share.members.length >= 50) throw new Error('Participant limit reached');
      this.nonces.set(nonceKey, Date.now() + 120000);
      const accessToken = secret();
      if (member)
        Object.assign(member, {
          ...request.peer,
          role,
          tokenHash: digest(accessToken),
          grantId: randomUUID(),
        });
      else {
        member = { ...request.peer, role, tokenHash: digest(accessToken), grantId: randomUUID() };
        share.members.push(member);
      }
      member.admitted = true;
      share.requests = (share.requests ?? []).filter((request) => request.peer.id !== member!.id);
      this.typing.clear(share.id, member.id);
      this.save();
      return {
        token: accessToken,
        title: this.store.get(share.id)!.title,
        ownerId: this.identity.public().id,
      };
    }
    const member = share.members.find((member) => member.id === request.peer.id);
    if (
      !member ||
      member.blocked ||
      member.publicKey !== request.peer.publicKey ||
      !matches(member.tokenHash, token)
    )
      throw new Error('Access revoked; ask the host to restore your role or request access again');
    this.nonces.set(nonceKey, Date.now() + 120000);
    if (member.name !== request.peer.name) {
      member.name = request.peer.name;
      this.save();
    }
    const data = request.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid request data');
    if (request.operation === 'snapshot') {
      const snapshot = this.agents.snapshot(this.store.get(share.id)!);
      const messages = snapshot.messages.slice(-100).map((message) => ({
        ...message,
        text:
          message.text.length > 20000
            ? `${message.text.slice(0, 20000)}\n[Truncated in the LAN view]`
            : message.text,
      }));
      return {
        id: share.id,
        title: snapshot.chat.title,
        owner: this.identity.public(),
        role: member.role,
        typing: this.typingPeople(share.id),
        historyLimited:
          snapshot.messages.length > 100 ||
          snapshot.messages.some((message) => message.text.length > 20000),
        messages,
        queue: snapshot.queue.map((prompt) => ({
          id: prompt.id,
          text: prompt.text.slice(0, 200),
          actorId: prompt.actorId,
        })),
        queuePaused: snapshot.queuePaused,
        queuesEnabled: this.agents.settings.read().queuesEnabled,
        busy: snapshot.busy,
        error: snapshot.error,
        plan: snapshot.chat.plan ?? [],
      };
    }
    if (request.operation === 'list')
      return this.files(share.id).list(typeof data.path === 'string' ? data.path : '');
    if (request.operation === 'read') {
      if (typeof data.path !== 'string') throw new Error('Choose a file');
      return this.files(share.id).read(data.path);
    }
    if (member.role !== 'writer') throw new Error('Read-only participant');
    if (request.operation === 'typing') {
      this.typing.update(share.id, member.id, data.client, data.active);
      return { ok: true };
    }
    if (request.operation === 'message') {
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 100000)
        throw new Error('Invalid prompt');
      this.typing.clear(share.id, member.id);
      const text = `[Writer · ${member.name}]\n${data.text.trim()}`;
      if (this.agents.settings.read().queuesEnabled)
        this.agents.enqueue(this.store.get(share.id)!, text, undefined, member.id, member.grantId);
      else {
        if (this.agents.busy(share.id))
          throw new Error('Queues are disabled; wait for the current response');
        void this.agents.prompt(this.store.get(share.id)!, text).catch(() => {});
      }
      return { ok: true };
    }
    if (request.operation === 'write') {
      if (typeof data.path !== 'string' || typeof data.data !== 'string')
        throw new Error('Invalid file');
      return this.files(share.id).write(data.path, data.data, data.hash);
    }
    if (request.operation === 'remove') {
      if (typeof data.path !== 'string') throw new Error('Choose a file');
      return this.files(share.id).remove(data.path, data.hash);
    }
    throw new Error('Unsupported shared operation');
  }
}
