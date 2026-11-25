export interface Chat { id: string; title: string; cwd: string; createdAt: string; updatedAt: string }
export interface Message { role: string; text: string; toolName?: string; isError?: boolean }
export interface ActivityEvent { id: string; type: 'agent' | 'tool' | 'test'; label: string; status: 'running' | 'passed' | 'failed' | 'stopped' | 'interrupted'; timestamp: string; durationMs?: number; detail?: string }
export interface QueuedPrompt { id: string; text: string; model?: string; timestamp: string }
export interface Snapshot { chat: Chat; queue?: QueuedPrompt[]; queuePaused?: boolean; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null }; contextStale?: boolean; events?: ActivityEvent[]; messages: Message[]; busy: boolean; tool?: string; error?: string; model?: string }
export interface Config { version: string; defaultCwd: string; models: { key: string; name: string; provider: string }[] }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}
