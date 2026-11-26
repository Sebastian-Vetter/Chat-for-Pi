import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownTranscript } from '../src/markdown-export.js';

test('Markdown exports include only visible conversation messages and safely fence tool output', () => {
  const text = markdownTranscript('Example\n# title', [
    { role: 'user', text: 'Question' },
    { role: 'assistant', text: '**Visible answer**' },
    { role: 'toolResult', text: '```\noutput\n```', toolName: 'bash' },
    { role: 'thinking', text: 'must stay private' },
  ]);
  assert.match(text, /^# Example \\# title/);
  assert.match(text, /## Pi\n\n\*\*Visible answer\*\*/);
  assert.match(text, /````text\n```/);
  assert.doesNotMatch(text, /must stay private/);
});
