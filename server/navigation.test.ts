import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION_KEY, readNavigation, saveNavigation } from '../src/navigation.js';

test('navigation restores local/shared selections and explicit sidebar state without touching settings', () => {
  const values = new Map<string, string>([
    ['pi-chat-active', 'legacy-chat'],
    ['pi-chat-settings', '{"finishSound":false}'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  assert.deepEqual(readNavigation(storage, false), {
    active: 'legacy-chat',
    remote: null,
    sidebarOpen: false,
    tab: 'chats',
    hasSavedTab: false,
  });
  const state = {
    active: 'local-chat',
    remote: 'joined-chat',
    sidebarOpen: false,
    tab: 'shared' as const,
  };
  assert.equal(saveNavigation(state, storage), true);
  assert.deepEqual(readNavigation(storage, true), { ...state, hasSavedTab: true });
  saveNavigation({ active: null, remote: null, sidebarOpen: true, tab: 'chats' }, storage);
  assert.deepEqual(readNavigation(storage, false), {
    active: null,
    remote: null,
    sidebarOpen: true,
    tab: 'chats',
    hasSavedTab: true,
  });
  assert.equal(values.get('pi-chat-settings'), '{"finishSound":false}');
});

test('damaged, unsafe, future and unavailable browser storage fall back without losing a valid legacy chat', () => {
  for (const value of [
    '{',
    'null',
    '[]',
    '{"version":2,"tab":"shared"}',
    '{"version":1,"sidebarOpen":"false","remote":"../private?x","tab":"other"}',
  ]) {
    const result = readNavigation(
      { getItem: (key) => (key === NAVIGATION_KEY ? value : 'valid-chat') },
      true,
    );
    assert.deepEqual(result, {
      active: 'valid-chat',
      remote: null,
      sidebarOpen: true,
      tab: 'chats',
      hasSavedTab: false,
    });
  }
  const blocked = {
    getItem: () => {
      throw new Error('Blocked');
    },
    setItem: () => {
      throw new Error('Quota exceeded');
    },
    removeItem: () => {
      throw new Error('Blocked');
    },
  };
  assert.equal(readNavigation(blocked, false).sidebarOpen, false);
  assert.equal(
    saveNavigation({ active: null, remote: null, sidebarOpen: true, tab: 'shared' }, blocked),
    false,
  );
  assert.equal(readNavigation({ getItem: () => '../bad' }, false).active, null);
});
