import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from './store.js';
import { AgentService } from './agent.js';
import { SharedService, invitationMessage, type SharedInvite } from './shared.js';
import { SharedNetwork, parseInvite, remoteCall } from './shared-network.js';
import { SharedFiles, MAX_SHARED_FILE } from './shared-files.js';
import https from 'node:https';

function fixture(root: string, name: string) {
  const store = new ChatStore(join(root, name));
  const agents = new AgentService(store);
  const shared = new SharedService(store, agents);
  shared.identity.rename(name);
  return { store, agents, shared };
}

test('installation identity persists and shared projects require a separate empty folder and remain permanently shared', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-share-'));
  const owner = fixture(root, 'Owner');
  try {
    const id = owner.shared.identity.public().id;
    assert.equal(new SharedService(owner.store, owner.agents).identity.public().id, id);
    assert.throws(() => owner.shared.identity.rename(' '), /Invalid/);
    assert.throws(() => owner.shared.identity.rename('name\nspoof'), /Invalid/);
    const busy = join(root, 'busy');
    mkdirSync(busy);
    writeFileSync(join(busy, '.hidden'), 'private');
    assert.throws(() => owner.shared.create(busy, 'Hidden data', true), /empty/);
    assert.throws(
      () => owner.shared.create(join(root, 'project'), 'Consent missing', false),
      /Confirm/,
    );
    const chat = owner.shared.create(join(root, 'project'), 'Shared project', true);
    assert.equal(chat.shared, true);
    assert.equal(new ChatStore(owner.store.directory).get(chat.id)?.shared, true);
    assert.throws(
      () => owner.shared.create(chat.cwd, 'Same project', true),
      /overlap|separate|belongs/,
    );
    assert.equal(owner.shared.protectedFolder(join(chat.cwd, 'child')), true);
    owner.shared.access(chat.id, true);
    owner.shared.access(chat.id, false);
    assert.equal(chat.shared, true);
    assert.equal(owner.shared.list().owned[0].enabled, false);
    assert.doesNotMatch(JSON.stringify(owner.shared.list()), /privateKey|tokenHash/);
  } finally {
    await owner.agents.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test('reader/writer authorization, proof binding, queue attribution, role revocation and sharing off are enforced at execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-share-roles-'));
  const owner = fixture(root, 'Owner'),
    reader = fixture(root, 'Reader'),
    writer = fixture(root, 'Writer');
  try {
    const chat = owner.shared.create(join(root, 'project'), 'Project', true);
    const calls: string[] = [];
    (owner.agents as unknown as { sessions: Map<string, unknown> }).sessions.set(chat.id, {
      messages: [],
      state: {},
      getContextUsage: () => undefined,
      dispose: () => {},
      abort: async () => {},
      prompt: async (text: string) => {
        calls.push(text);
      },
    });
    owner.shared.access(chat.id, true);
    const joinPeer = (peer: typeof reader, role: 'reader' | 'writer') => {
      const invitation = owner.shared.invitation(chat.id, role);
      const envelope = peer.shared.signed(chat.id, invitation, 'join', {});
      const payload = JSON.parse(envelope.payload);
      Object.assign(payload.peer, { role: 'owner', privateKey: 'DO_NOT_STORE', grantId: 'ATTACK' });
      envelope.payload = JSON.stringify(payload);
      envelope.signature = peer.shared.identity.sign(envelope.payload);
      return (owner.shared.rpc(envelope, invitation) as { token: string }).token;
    };
    const readerToken = joinPeer(reader, 'reader'),
      writerToken = joinPeer(writer, 'writer');
    assert.doesNotMatch(JSON.stringify(owner.shared.list()), /privateKey|DO_NOT_STORE|ATTACK/);
    const rpc = (peer: typeof reader, token: string, operation: string, data = {}) =>
      owner.shared.rpc(peer.shared.signed(chat.id, token, operation, data), token);
    assert.throws(
      () => rpc(reader, readerToken, 'write', { path: 'a.txt', data: '', hash: null }),
      /Read-only/,
    );
    assert.throws(
      () => rpc(reader, readerToken, 'message', { text: 'Do not execute' }),
      /Read-only/,
    );
    assert.throws(() => rpc(writer, readerToken, 'snapshot'), /revoked/);
    const typingClient = '00000000-0000-4000-8000-000000000001';
    assert.throws(
      () => rpc(reader, readerToken, 'typing', { client: typingClient, active: true }),
      /Read-only/,
    );
    rpc(writer, writerToken, 'typing', {
      client: typingClient,
      active: true,
      name: 'Forged owner',
      text: 'DO_NOT_STORE_DRAFT',
    });
    owner.shared.ownerTyping(chat.id, typingClient, true);
    assert.deepEqual(
      owner.shared
        .typingPeople(chat.id)
        .map((person) => person.name)
        .sort(),
      ['Owner', 'Writer'],
    );
    assert.doesNotMatch(
      readFileSync(join(owner.store.directory, 'shared.json'), 'utf8'),
      /DO_NOT_STORE_DRAFT|Forged owner|00000000-0000-4000-8000-000000000001/,
    );
    const signed = reader.shared.signed(chat.id, readerToken, 'snapshot', {});
    const snapshot = owner.shared.rpc(signed, readerToken) as { role: string; messages: unknown[] };
    assert.equal(snapshot.role, 'reader');
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /sessionFile|privateKey|tokenHash|"cwd"|approvals/,
    );
    assert.throws(() => owner.shared.rpc(signed, readerToken), /Replayed/);
    const tampered = writer.shared.signed(chat.id, writerToken, 'snapshot', {});
    tampered.payload = tampered.payload.replace('snapshot', 'message');
    assert.throws(() => owner.shared.rpc(tampered, writerToken), /proof/);
    rpc(writer, writerToken, 'write', {
      path: 'src/hello.txt',
      data: Buffer.from('hello').toString('base64'),
      hash: null,
    });
    assert.equal(
      Buffer.from(
        (rpc(reader, readerToken, 'read', { path: 'src/hello.txt' }) as { data: string }).data,
        'base64',
      ).toString(),
      'hello',
    );
    assert.throws(
      () => rpc(writer, writerToken, 'write', { path: 'src/hello.txt', data: '', hash: null }),
      /changed/,
    );
    owner.agents.pauseQueue(chat, true);
    rpc(writer, writerToken, 'message', { text: 'Queued by writer' });
    assert.equal(
      owner.agents.queues.state(chat.id).items[0].actorId,
      writer.shared.identity.public().id,
    );
    owner.shared.member(chat.id, writer.shared.identity.public().id, 'reader');
    assert.deepEqual(
      owner.shared.typingPeople(chat.id).map((person) => person.name),
      ['Owner'],
    );
    owner.agents.pauseQueue(chat, false);
    assert.deepEqual(calls, []);
    assert.equal(owner.agents.queues.state(chat.id).items.length, 0);
    assert.throws(
      () => rpc(writer, writerToken, 'message', { text: 'Revoked writer' }),
      /Read-only/,
    );
    owner.shared.member(chat.id, writer.shared.identity.public().id, 'writer');
    owner.agents.pauseQueue(chat, true);
    rpc(writer, writerToken, 'message', { text: 'Old authorization must not revive' });
    owner.shared.member(chat.id, writer.shared.identity.public().id, 'reader');
    owner.shared.member(chat.id, writer.shared.identity.public().id, 'writer');
    owner.agents.pauseQueue(chat, false);
    assert.deepEqual(calls, []);
    assert.equal(owner.agents.queues.state(chat.id).items.length, 0);
    owner.agents.setQueuesEnabled(false);
    // Simulate a running response without ever creating a real model session.
    (owner.agents as unknown as { running: Set<string> }).running.add(chat.id);
    assert.throws(() => rpc(writer, writerToken, 'message', { text: 'Queues off' }), /disabled/);
    (owner.agents as unknown as { running: Set<string> }).running.delete(chat.id);
    owner.shared.access(chat.id, false);
    assert.throws(() => rpc(reader, readerToken, 'snapshot'), /off/);
    owner.shared.access(chat.id, true);
    assert.deepEqual(owner.shared.typingPeople(chat.id), []);
    assert.throws(() => rpc(reader, readerToken, 'snapshot'), /revoked/);
    owner.shared.member(chat.id, reader.shared.identity.public().id, 'removed');
    const newInvitation = owner.shared.invitation(chat.id, 'reader');
    assert.throws(
      () =>
        owner.shared.rpc(reader.shared.signed(chat.id, newInvitation, 'join', {}), newInvitation),
      /revoked/,
    );
  } finally {
    await Promise.all([
      owner.agents.shutdown(),
      reader.agents.shutdown(),
      writer.agents.shutdown(),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});

test('shared files reject traversal, links, overwrites and stale deletes without changing outside files', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-share-files-'));
  try {
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(root, 'secret'), 'private');
    const files = new SharedFiles(project);
    for (const path of ['../secret', '/etc/passwd', 'folder/../secret', 'C:\\secret', 'a//b'])
      assert.throws(() => files.read(path), /Invalid/);
    symlinkSync(join(root, 'secret'), join(project, 'link'));
    symlinkSync(join(root, 'missing'), join(project, 'dangling'));
    assert.throws(() => files.read('link'), /links/);
    assert.throws(() => files.write('dangling', '', null), /links/);
    assert.deepEqual(files.list(), []);
    const first = files.write('nested/file.txt', Buffer.from('one').toString('base64'), null);
    assert.throws(() => files.write('nested/file.txt', '', null), /changed/);
    assert.throws(() => files.remove('nested/file.txt', 'stale'), /changed/);
    const second = files.write(
      'nested/file.txt',
      Buffer.from('two').toString('base64'),
      first.hash,
    );
    assert.equal(files.read('nested/file.txt').hash, second.hash);
    files.remove('nested/file.txt', second.hash);
    assert.equal(readFileSync(join(root, 'secret'), 'utf8'), 'private');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LAN gateway uses pinned TLS and scoped signed invitations, never exposes the private API, and does not start by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-share-tls-'));
  const owner = fixture(root, 'Owner'),
    client = fixture(root, 'Client');
  const network = new SharedNetwork(owner.shared),
    clientNetwork = new SharedNetwork(client.shared);
  try {
    assert.equal(network.status().enabled, false);
    const chat = owner.shared.create(join(root, 'project'), 'LAN project', true);
    owner.shared.access(chat.id, true);
    const status = await network.start('127.0.0.1', 0, false);
    assert.equal(status.enabled, true);
    const link = network.invite(chat.id, 'reader').link;
    const invitation = parseInvite(link);
    assert.throws(() => parseInvite(link.replace('127.0.0.1:3001', 'evil.example')), /Invalid/);
    const evil: SharedInvite = { ...invitation, endpoint: 'https://example.com/' };
    assert.throws(
      () =>
        parseInvite(
          `http://127.0.0.1:3001/#join=${Buffer.from(JSON.stringify(evil)).toString('base64url')}`,
        ),
      /private/,
    );
    const changedToken = {
      ...invitation,
      token: `${invitation.token[0] === 'A' ? 'B' : 'A'}${invitation.token.slice(1)}`,
    };
    assert.throws(
      () =>
        parseInvite(
          `http://127.0.0.1:3001/#join=${Buffer.from(JSON.stringify(changedToken)).toString('base64url')}`,
        ),
      /signed owner/,
    );
    const joined = (await remoteCall(
      invitation,
      invitation.token,
      client.shared.signed(chat.id, invitation.token, 'join', {}),
    )) as { token: string };
    const snapshot = (await remoteCall(
      invitation,
      joined.token,
      client.shared.signed(chat.id, joined.token, 'snapshot', {}),
    )) as { title: string; role: string };
    assert.equal(snapshot.title, 'LAN project');
    assert.equal(snapshot.role, 'reader');
    await assert.rejects(
      remoteCall(
        invitation,
        joined.token,
        client.shared.signed(chat.id, joined.token, '/api/chats', {}),
      ),
      /Read-only|Unsupported/,
    );
    client.shared.addRemote(invitation, joined.token, 'LAN project');
    const forged: SharedInvite = {
      ...invitation,
      owner: { ...client.shared.identity.public(), id: invitation.ownerId },
    };
    forged.ownerProof = client.shared.identity.sign(invitationMessage(forged));
    const forgedParsed = parseInvite(
      `http://127.0.0.1:3001/#join=${Buffer.from(JSON.stringify(forged)).toString('base64url')}`,
    );
    assert.throws(() => client.shared.assertKnownOwner(forgedParsed), /identity key changed/);
    await clientNetwork.start('127.0.0.1', 0, false);
    await assert.rejects(
      remoteCall(
        {
          ...invitation,
          certificate: readFileSync(join(client.store.directory, 'lan-cert.pem'), 'utf8'),
        },
        joined.token,
        client.shared.signed(chat.id, joined.token, 'snapshot', {}),
      ),
      /certificate|self-signed|pinned/i,
    );
    const privateStatus = await new Promise<number>((resolve, reject) => {
      const request = https.request(
        new URL('/api/chats', invitation.endpoint),
        {
          method: 'POST',
          ca: invitation.certificate,
          checkServerIdentity: () => undefined,
          headers: {
            Authorization: `Bearer ${joined.token}`,
            'Content-Type': 'application/json',
            'Content-Length': 2,
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        },
      );
      request.on('error', reject);
      request.end('{}');
    });
    assert.equal(privateStatus, 404);
    assert.equal(owner.store.list().length, 1);
    owner.shared.member(chat.id, client.shared.identity.public().id, 'writer');
    await remoteCall(
      invitation,
      joined.token,
      client.shared.signed(chat.id, joined.token, 'typing', {
        client: '00000000-0000-4000-8000-000000000001',
        active: true,
      }),
    );
    const presence = (await remoteCall(
      invitation,
      joined.token,
      client.shared.signed(chat.id, joined.token, 'snapshot', {}),
    )) as { typing: { name: string }[] };
    assert.deepEqual(
      presence.typing.map((person) => person.name),
      ['Client'],
    );
    const content = Buffer.alloc(MAX_SHARED_FILE, 42).toString('base64');
    await remoteCall(
      invitation,
      joined.token,
      client.shared.signed(chat.id, joined.token, 'write', {
        path: 'asset.bin',
        data: content,
        hash: null,
      }),
    );
    const downloaded = (await remoteCall(
      invitation,
      joined.token,
      client.shared.signed(chat.id, joined.token, 'read', { path: 'asset.bin' }),
    )) as { data: string };
    assert.equal(downloaded.data, content);
    owner.shared.access(chat.id, false);
    await assert.rejects(
      remoteCall(
        invitation,
        joined.token,
        client.shared.signed(chat.id, joined.token, 'snapshot', {}),
      ),
      /off|Authentication required/,
    );
    await network.stop();
    assert.equal(network.status().enabled, false);
  } finally {
    await Promise.all([network.stop(), clientNetwork.stop()]);
    await Promise.all([owner.agents.shutdown(), client.agents.shutdown()]);
    rmSync(root, { recursive: true, force: true });
  }
});
