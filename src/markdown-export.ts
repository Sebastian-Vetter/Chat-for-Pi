import type { Message } from './api';

export function markdownTranscript(title: string, messages: Message[]) {
  const heading = title.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#]/g, '\\$&');
  return `# ${heading}\n\n${messages
    .filter((message) => ['user', 'assistant', 'toolResult'].includes(message.role))
    .map((message) => {
      const author =
        message.role === 'user'
          ? 'You'
          : message.role === 'assistant'
            ? 'Pi'
            : `Tool: ${message.toolName ?? 'output'}`;
      if (message.role !== 'toolResult') return `## ${author}\n\n${message.text}\n`;
      const fence = '`'.repeat(
        Array.from(message.text.matchAll(/`+/g)).reduce(
          (maximum, match) => Math.max(maximum, match[0].length + 1),
          3,
        ),
      );
      return `## ${author.replace(/[\r\n]/g, ' ')}\n\n${fence}text\n${message.text}\n${fence}\n`;
    })
    .join('\n')}\n`;
}

export function downloadMarkdown(title: string, messages: Message[]) {
  const blob = new Blob([markdownTranscript(title, messages)], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'conversation'}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
