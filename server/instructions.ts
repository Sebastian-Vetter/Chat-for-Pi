import { getAgentDir, loadProjectContextFiles } from '@earendil-works/pi-coding-agent';
import { dirname, resolve } from 'node:path';
export interface ContextFile { path: string; content: string }
export function conversationInstructions(cwd: string, loaded?: ContextFile[], agentDir = getAgentDir()) {
  const files = loaded ?? loadProjectContextFiles({ cwd, agentDir });
  return {
    source: loaded ? 'session' : 'discovered',
    files: files.map(file => ({
      path: file.path, name: file.path.split('/').at(-1)!,
      scope: dirname(file.path) === resolve(agentDir) ? 'Global' : dirname(file.path) === resolve(cwd) ? 'Workspace' : 'Parent directory',
      content: file.content.slice(0, 256 * 1024), truncated: file.content.length > 256 * 1024,
    })),
  };
}
