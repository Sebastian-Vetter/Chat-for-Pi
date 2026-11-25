export interface Chat { id: string; title: string; cwd: string; createdAt: string; updatedAt: string }
export interface Message { role: string; text: string; toolName?: string; isError?: boolean }
export interface Snapshot { chat: Chat; messages: Message[]; busy: boolean; tool?: string; error?: string; model?: string }
export interface Config { defaultCwd: string; models: { key: string; name: string; provider: string }[] }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}
