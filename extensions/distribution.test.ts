import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import distribution from './distribution.ts';

test('distribution extension is inert on load and refuses unconfirmed installs and stops', async () => {
  let command: Parameters<ExtensionAPI['registerCommand']>[1] | undefined;
  const registered: string[] = [];
  distribution({
    registerCommand(name, definition) {
      registered.push(name);
      command = definition;
    },
  } as ExtensionAPI);
  assert.deepEqual(registered, ['chat-server']);
  assert.deepEqual(
    (await command!.getArgumentCompletions?.('inst'))?.map((item) => item.value),
    ['install'],
  );
  const notices: string[] = [];
  let confirmations = 0;
  const ctx = {
    hasUI: false,
    ui: {
      notify(message: string) {
        notices.push(message);
      },
      async confirm() {
        confirmations++;
        return false;
      },
    },
  } as unknown as ExtensionCommandContext;
  await command!.handler('install', ctx);
  assert.match(notices.at(-1)!, /interactive confirmation/);
  assert.equal(confirmations, 0);
  await command!.handler('stop', { ...ctx, hasUI: true });
  assert.equal(confirmations, 1);
  await command!.handler('unsupported', ctx);
  assert.match(notices.at(-1)!, /Usage:/);
});
