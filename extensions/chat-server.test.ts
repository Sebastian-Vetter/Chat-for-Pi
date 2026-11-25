import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import extension from './chat-server.ts';

test('extension registers the command without starting a service and completes its actions', async () => {
  let command: Parameters<ExtensionAPI['registerCommand']>[1] | undefined;
  extension({ registerCommand(name, options) { assert.equal(name, 'chat-server'); command = options; } } as ExtensionAPI);
  assert.ok(command);
  assert.deepEqual(await command.getArgumentCompletions?.('sta'), [{ value: 'start', label: 'start' }, { value: 'status', label: 'status' }]);
  const notices: string[] = [];
  await command.handler('invalid', { ui: { notify(message: string) { notices.push(message); } } } as ExtensionCommandContext);
  assert.match(notices[0], /Usage/);
});
