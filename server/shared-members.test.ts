import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ChatStore } from './store.js';
import { AgentService } from './agent.js';
import { SharedService } from './shared.js';
import { SharedNetwork, parseInvite, remoteCall } from './shared-network.js';

function fixture(root: string, name: string) {
  const store = new ChatStore(join(root, name)),
    agents = new AgentService(store);
  const shared = new SharedService(store, agents);
  shared.identity.rename(name);
  return { store, agents, shared, network: new SharedNetwork(shared) };
}
test('revoked members reconnect automatically after role restoration; deletion invalidates credentials, invitations and queue grants without automatic readmission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-members-'));
  const owner = fixture(root, 'Owner'),
    client = fixture(root, 'Guest');
  try {
    const chat = owner.shared.create(join(root, 'project'), 'Members project', true);
    owner.shared.access(chat.id, true);
    await owner.network.start('127.0.0.1', 0, false);
    client.network.observe(owner.network.advertisement(), '127.0.0.1');
    const ownerId = owner.shared.identity.public().id,
      actor = client.shared.identity.public().id;
    await client.network.requestAccess(ownerId, chat.id);
    owner.shared.decideAccess(chat.id, owner.shared.list().owned[0].requests[0].id, 'writer');
    await client.network.access.poll();
    const id = client.network.status().requests[0].remoteId!;
    const epoch = () =>
      JSON.parse(readFileSync(join(owner.store.directory, 'shared.json'), 'utf8')).shares[0]
        .members[0].grantId as string;
    const snapshot = () => client.network.proxy(id, 'snapshot', {}) as Promise<{ role: string }>;
    assert.equal((await snapshot()).role, 'writer');
    const oldEpoch = epoch(),
      oldToken = client.shared.remote(id).token;
    await client.network.proxy(id, 'typing', { client: randomUUID(), active: true });
    assert.equal(owner.shared.typingPeople(chat.id)[0].id, actor);
    owner.shared.member(chat.id, actor, 'removed');
    assert.deepEqual(owner.shared.typingPeople(chat.id), []);
    await assert.rejects(snapshot(), /Access revoked/);
    assert.equal(owner.shared.list().owned[0].requests.length, 0);
    owner.shared.member(chat.id, actor, 'writer');
    // Mutations must never be retried or silently reauthorized after a failure.
    await assert.rejects(
      client.network.proxy(id, 'message', { text: 'Must not execute', enqueue: false }),
      /Authentication required/,
    );
    assert.equal(client.shared.remote(id).token, oldToken);
    const results = await Promise.all([snapshot(), snapshot(), snapshot()]);
    assert.deepEqual(
      results.map((result) => result.role),
      ['writer', 'writer', 'writer'],
    );
    assert.notEqual(client.shared.remote(id).token, oldToken);
    assert.equal(owner.shared.canWrite(chat.id, actor, oldEpoch), false);
    const renewedEpoch = epoch();
    assert.equal(owner.shared.canWrite(chat.id, actor, renewedEpoch), true);
    assert.equal(owner.shared.list().owned[0].requests.length, 0);
    owner.shared.member(chat.id, actor, 'removed');
    await assert.rejects(snapshot(), /Access revoked/);
    owner.shared.member(chat.id, actor, 'reader');
    assert.equal((await snapshot()).role, 'reader');
    await assert.rejects(
      client.network.proxy(id, 'write', { path: 'no.txt', data: '', hash: null }),
      /Read-only/,
    );
    const invitation = parseInvite(owner.network.invite(chat.id, 'writer').link);
    const deletedToken = client.shared.remote(id).token;
    owner.shared.removeMember(chat.id, actor);
    assert.deepEqual(owner.shared.list().owned[0].members, []);
    assert.throws(() => owner.shared.removeMember(chat.id, actor), /not found/);
    const restored = new SharedService(owner.store, owner.agents);
    assert.deepEqual(restored.list().owned[0].members, []);
    assert.equal(restored.canWrite(chat.id, actor, renewedEpoch), false);
    await assert.rejects(
      remoteCall(
        invitation,
        invitation.token,
        client.shared.signed(chat.id, invitation.token, 'join', {}),
      ),
      /Authentication required/,
    );
    await assert.rejects(
      remoteCall(
        client.shared.remote(id).invite,
        deletedToken,
        client.shared.signed(chat.id, deletedToken, 'snapshot', {}),
      ),
      /Authentication required/,
    );
    await assert.rejects(snapshot(), /Access revoked/);
    assert.equal(owner.shared.list().owned[0].requests.length, 0);
    await client.network.requestAccess(ownerId, chat.id);
    assert.equal(client.network.status().requests[0].state, 'pending');
    owner.shared.decideAccess(chat.id, owner.shared.list().owned[0].requests[0].id, 'writer');
    await client.network.access.poll();
    assert.equal(client.network.status().requests[0].remoteId, id);
    assert.equal((await snapshot()).role, 'writer');
    assert.equal(owner.shared.canWrite(chat.id, actor, renewedEpoch), false);
    await assert.rejects(
      client.network.proxy(id, 'delete-member', { memberId: actor }),
      /Unsupported/,
    );
  } finally {
    await Promise.all([owner.network.stop(), client.network.stop()]);
    await Promise.all([owner.agents.shutdown(), client.agents.shutdown()]);
    rmSync(root, { recursive: true, force: true });
  }
});
