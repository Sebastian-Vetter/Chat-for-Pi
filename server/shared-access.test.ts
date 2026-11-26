import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChatStore } from './store.js';
import { AgentService } from './agent.js';
import { SharedService, ACCESS_MARKER } from './shared.js';
import { SharedNetwork, remoteCall } from './shared-network.js';
function fixture(root: string, name: string) {
  const store = new ChatStore(join(root, name)),
    agents = new AgentService(store);
  const shared = new SharedService(store, agents);
  shared.identity.rename(name);
  return { store, agents, shared };
}

test('discovered access requests require owner approval, persist grants across restart, and honor denial/off/revocation over pinned TLS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-access-'));
  const owner = fixture(root, 'Owner'),
    client = fixture(root, 'Client'),
    attacker = fixture(root, 'Attacker');
  let network = new SharedNetwork(owner.shared);
  const clientNetwork = new SharedNetwork(client.shared);
  try {
    const chat = owner.shared.create(join(root, 'project'), 'Requested project', true);
    owner.shared.access(chat.id, true);
    await network.start('127.0.0.1', 0, false);
    clientNetwork.observe(network.advertisement(), '127.0.0.1');
    assert.equal(clientNetwork.status().peers[0].canRequest, true);
    const ownerId = owner.shared.identity.public().id;
    let status = await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(status.requests[0].state, 'pending');
    assert.equal(client.shared.list().joined.length, 0);
    assert.equal(owner.shared.list().owned[0].members.length, 0);
    const requestId = owner.shared.list().owned[0].requests[0].id;
    await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(owner.shared.list().owned[0].requests.length, 1);
    const invitation = network.invite(chat.id, 'reader');
    const target = JSON.parse(
      Buffer.from(
        new URLSearchParams(new URL(invitation.link).hash.slice(1)).get('join')!,
        'base64url',
      ).toString(),
    );
    await assert.rejects(
      remoteCall(
        target,
        ACCESS_MARKER,
        client.shared.signed(chat.id, ACCESS_MARKER, 'snapshot', {}),
      ),
      /Authentication required/,
    );
    await assert.rejects(
      remoteCall(
        target,
        '',
        client.shared.signed(chat.id, ACCESS_MARKER, 'snapshot', {}),
        'access',
      ),
      /Unsupported access/,
    );
    owner.shared.decideAccess(chat.id, requestId, 'reader');
    assert.throws(() => owner.shared.decideAccess(chat.id, requestId, null), /no longer pending/);
    await clientNetwork.access.poll();
    status = clientNetwork.status();
    assert.equal(status.requests[0].state, 'approved');
    const joinedId = status.requests[0].remoteId!;
    const remote = client.shared.remote(joinedId);
    const snapshot = (await remoteCall(
      remote.invite,
      remote.token,
      client.shared.signed(chat.id, remote.token, 'snapshot', {}),
    )) as { role: string };
    assert.equal(snapshot.role, 'reader');
    await assert.rejects(
      remoteCall(
        remote.invite,
        remote.token,
        client.shared.signed(chat.id, remote.token, 'write', {
          path: 'no.txt',
          data: '',
          hash: null,
        }),
      ),
      /Read-only/,
    );
    await network.stop();
    const restored = new SharedService(owner.store, owner.agents);
    network = new SharedNetwork(restored);
    await network.start('127.0.0.1', 0, false);
    clientNetwork.observe(network.advertisement(), '127.0.0.1');
    status = await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(status.requests[0].state, 'approved');
    assert.equal(status.requests[0].remoteId, joinedId);
    assert.equal(restored.list().owned[0].requests.length, 0);
    assert.equal(new SharedService(client.store, client.agents).list().joined[0].id, joinedId);
    restored.access(chat.id, false);
    restored.access(chat.id, true);
    status = await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(status.requests[0].state, 'pending');
    const fresh = restored.list().owned[0].requests[0];
    assert.notEqual(fresh.id, requestId);
    assert.throws(() => restored.decideAccess(chat.id, requestId, 'writer'), /no longer pending/);
    restored.decideAccess(chat.id, fresh.id, null);
    await clientNetwork.access.poll();
    assert.equal(clientNetwork.status().requests[0].state, 'denied');
    status = await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(status.requests[0].state, 'denied');
    assert.equal(restored.list().owned[0].requests.length, 0);
    restored.member(chat.id, client.shared.identity.public().id, 'removed');
    status = await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(status.requests[0].state, 'denied');
    restored.member(chat.id, client.shared.identity.public().id, 'writer');
    const epoch: string = JSON.parse(
      readFileSync(join(owner.store.directory, 'shared.json'), 'utf8'),
    ).shares[0].members[0].grantId;
    status = await clientNetwork.requestAccess(ownerId, chat.id);
    assert.equal(status.requests[0].state, 'approved');
    assert.equal(restored.canWrite(chat.id, client.shared.identity.public().id, epoch), true);
    const ad = JSON.parse(network.advertisement().toString());
    const value = JSON.parse(ad.payload);
    value.peer.publicKey = attacker.shared.identity.public().publicKey;
    ad.payload = JSON.stringify(value);
    ad.signature = attacker.shared.identity.sign(ad.payload);
    clientNetwork.observe(Buffer.from(JSON.stringify(ad)), '127.0.0.1');
    await assert.rejects(clientNetwork.requestAccess(ownerId, chat.id), /identity key changed/);
  } finally {
    await Promise.all([network.stop(), clientNetwork.stop()]);
    await Promise.all([
      owner.agents.shutdown(),
      client.agents.shutdown(),
      attacker.agents.shutdown(),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});

test('access proof replay, tampering, private sessions and invalid owner decisions fail closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-access-proof-'));
  const owner = fixture(root, 'Owner'),
    client = fixture(root, 'Client');
  try {
    const chat = owner.shared.create(join(root, 'project'), 'Project', true);
    owner.shared.access(chat.id, true);
    const request = client.shared.signed(chat.id, ACCESS_MARKER, 'access-request', {
      role: 'owner',
    });
    assert.deepEqual(owner.shared.accessRPC(request), { state: 'pending' });
    assert.throws(() => owner.shared.accessRPC(request), /Replayed/);
    const pending = owner.shared.list().owned[0].requests[0];
    assert.throws(() => owner.shared.decideAccess(chat.id, pending.id, 'owner'), /Choose/);
    assert.equal(owner.shared.list().owned[0].members.length, 0);
    const forged = client.shared.signed(chat.id, ACCESS_MARKER, 'access-status', {});
    forged.payload = forged.payload.replace('access-status', 'access-request');
    assert.throws(() => owner.shared.accessRPC(forged), /proof/);
    const privateChat = owner.store.create(root);
    assert.throws(
      () =>
        owner.shared.accessRPC(
          client.shared.signed(privateChat.id, ACCESS_MARKER, 'access-request', {}),
        ),
      /Shared session not found/,
    );
    assert.throws(
      () =>
        owner.shared.accessRPC(
          client.shared.signed(chat.id, ACCESS_MARKER, 'message', { text: 'Never run' }),
        ),
      /Unsupported access/,
    );
    for (let index = 0; index < 25; index++) {
      const keys = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const envelope = client.shared.signed(chat.id, ACCESS_MARKER, 'access-request', {});
      const value = JSON.parse(envelope.payload);
      value.peer = { id: randomUUID(), name: `Guest ${index}`, publicKey: keys.publicKey };
      envelope.payload = JSON.stringify(value);
      envelope.signature = sign(null, Buffer.from(envelope.payload), keys.privateKey).toString(
        'base64',
      );
      if (index < 24) assert.deepEqual(owner.shared.accessRPC(envelope), { state: 'pending' });
      else assert.throws(() => owner.shared.accessRPC(envelope), /limit/);
    }
    assert.equal(owner.shared.list().owned[0].requests.length, 25);
    owner.shared.access(chat.id, false);
    assert.throws(() => owner.shared.decideAccess(chat.id, pending.id, 'reader'), /off/);
    assert.throws(
      () =>
        owner.shared.accessRPC(client.shared.signed(chat.id, ACCESS_MARKER, 'access-status', {})),
      /off/,
    );
  } finally {
    await Promise.all([owner.agents.shutdown(), client.agents.shutdown()]);
    rmSync(root, { recursive: true, force: true });
  }
});
