import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedTyping } from './shared-typing.js';
const client = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

test('typing leases expire, renew, isolate sessions and preserve other tabs', () => {
  let now = 0;
  const typing = new SharedTyping(() => now);
  typing.update('one', 'Alice', client(1), true);
  typing.update('one', 'Alice', client(2), true);
  typing.update('one', 'Bob', client(3), true);
  typing.update('two', 'Carol', client(4), true);
  typing.update('one', 'Alice', client(1), false);
  assert.deepEqual(typing.actors('one'), ['Alice', 'Bob']);
  now = 4000;
  typing.update('one', 'Bob', client(3), true);
  now = 6000;
  assert.deepEqual(typing.actors('one'), ['Bob']);
  assert.deepEqual(typing.actors('two'), []);
  now = 10000;
  assert.deepEqual(typing.actors('one'), []);
});

test('typing metadata validates input, bounds tabs and clears revoked actors or whole sessions', () => {
  const typing = new SharedTyping();
  assert.throws(() => typing.update('one', 'Alice', '../path', true), /Invalid/);
  assert.throws(() => typing.update('one', 'Alice', client(1), 'draft text'), /Invalid/);
  for (let i = 0; i < 8; i++) typing.update('one', 'Alice', client(i), true);
  assert.throws(() => typing.update('one', 'Alice', client(9), true), /limit/);
  typing.clear('one', 'Alice');
  assert.deepEqual(typing.actors('one'), []);
  typing.update('one', 'Bob', client(1), true);
  typing.clear('one');
  assert.deepEqual(typing.actors('one'), []);
  assert.deepEqual(new SharedTyping().actors('one'), []);
});
