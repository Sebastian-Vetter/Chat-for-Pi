import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownTranscript } from '../src/markdown-export.js';
import { expandTemplate, DEFAULT_TEMPLATES } from '../src/PromptTemplates.js';

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

test('prompt shortcuts expand exactly and preserve extra task context', () => {
  const templates = DEFAULT_TEMPLATES;
  assert.equal(templates.length, 3);
  assert.match(expandTemplate('/review src/App.tsx', templates), /src\/App\.tsx$/);
  assert.equal(expandTemplate('/review-more', templates), '/review-more');
  assert.equal(expandTemplate('/model', templates), '/model');
  assert.equal(expandTemplate('ordinary message', templates), 'ordinary message');
  assert.match(expandTemplate('/debug\nCrash report', templates), /Crash report$/);
});
