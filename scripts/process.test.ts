import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './process.ts';

test('process runner passes literal arguments without shell interpretation', async () => {
  const literal = 'hello; echo this-is-not-a-shell-command';
  const result = await run(process.execPath, [
    '-e',
    'process.stdout.write(process.argv[1])',
    literal,
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, literal);
  assert.equal(result.stderr, '');
});

test('process runner preserves nonzero exit codes and stderr', async () => {
  const result = await run(process.execPath, [
    '-e',
    'process.stderr.write("failure"); process.exit(7)',
  ]);
  assert.equal(result.code, 7);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'failure');
});
