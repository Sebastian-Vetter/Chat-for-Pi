import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationInstructions } from './instructions.js';
test('instruction discovery follows Pi global, parent, and workspace precedence', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'chat-instructions-')));
  const agentDir = join(dir, 'agent'), cwd = join(dir, 'project');
  mkdirSync(agentDir); mkdirSync(cwd);
  writeFileSync(join(agentDir, 'AGENTS.md'), 'Global instructions');
  writeFileSync(join(dir, 'AGENTS.md'), 'Parent instructions');
  writeFileSync(join(cwd, 'AGENTS.md'), 'Project instructions');
  try {
    const data = conversationInstructions(cwd, undefined, agentDir);
    assert.equal(data.source, 'discovered');
    assert.deepEqual(data.files.map(f => f.scope), ['Global', 'Parent directory', 'Workspace']);
    assert.equal(data.files[2].content, 'Project instructions');
    const loaded = conversationInstructions(cwd, [{ path: join(cwd, 'AGENTS.md'), content: 'Loaded version' }], agentDir);
    assert.equal(loaded.source, 'session'); assert.equal(loaded.files[0].content, 'Loaded version');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
