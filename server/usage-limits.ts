import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export const USAGE_PROVIDERS = ['openai-codex', 'anthropic'] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];
export interface UsageWindow {
  usedPercent: number;
  resetsAt?: string;
}
export interface UsageLimits {
  provider: UsageProvider;
  status: 'ok' | 'unavailable' | 'signin-required' | 'disabled';
  checkedAt: string;
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
  message?: string;
}
const ENDPOINTS: Record<UsageProvider, string> = {
  'openai-codex': 'https://chatgpt.com/backend-api/wham/usage',
  anthropic: 'https://api.anthropic.com/api/oauth/usage',
};
const CACHE_MS = 60000;
const MAX_BYTES = 256 * 1024;
type Runtime = Pick<ModelRuntime, 'checkAuth' | 'getAuth'>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function window(value: unknown, percentKey: string, resetKey: string): UsageWindow | undefined {
  const source = object(value);
  const percent = source[percentKey];
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)
    return;
  const reset = source[resetKey];
  const milliseconds =
    typeof reset === 'number' ? reset * 1000 : typeof reset === 'string' ? Date.parse(reset) : NaN;
  const date = new Date(milliseconds);
  return {
    usedPercent: percent,
    ...(Number.isFinite(date.getTime()) ? { resetsAt: date.toISOString() } : {}),
  };
}

export function parseUsage(
  provider: UsageProvider,
  value: unknown,
): Pick<UsageLimits, 'fiveHour' | 'weekly'> {
  const payload = object(value);
  if (provider === 'anthropic')
    return {
      fiveHour: window(payload.five_hour, 'utilization', 'resets_at'),
      weekly: window(payload.seven_day, 'utilization', 'resets_at'),
    };
  const limits = object(payload.rate_limit);
  const windows = [limits.primary_window, limits.secondary_window].map(object);
  return {
    fiveHour: window(
      windows.find((item) => item.limit_window_seconds === 18000),
      'used_percent',
      'reset_at',
    ),
    weekly: window(
      windows.find((item) => item.limit_window_seconds === 604800),
      'used_percent',
      'reset_at',
    ),
  };
}

function accountId(token: string): string | undefined {
  try {
    const claims = object(
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
    );
    const id = object(claims['https://api.openai.com/auth']).chatgpt_account_id;
    return typeof id === 'string' && /^[\w-]{1,200}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty usage response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Usage response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Explicit metadata requests only. Tokens and raw provider payloads never reach the browser. */
export class UsageLimitChecker {
  private cache = new Map<UsageProvider, { expires: number; value: UsageLimits }>();
  private pending = new Map<UsageProvider, Promise<UsageLimits>>();

  constructor(
    private runtime: Promise<Runtime>,
    private enabled = true,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}

  async check(provider: UsageProvider): Promise<UsageLimits> {
    const cached = this.cache.get(provider);
    if (cached && cached.expires > this.now()) return cached.value;
    const pending = this.pending.get(provider);
    if (pending) return pending;
    const request = this.load(provider)
      .then((value) => {
        this.cache.set(provider, { expires: this.now() + CACHE_MS, value });
        return value;
      })
      .finally(() => this.pending.delete(provider));
    this.pending.set(provider, request);
    return request;
  }

  private async load(provider: UsageProvider): Promise<UsageLimits> {
    const base = { provider, checkedAt: new Date(this.now()).toISOString() };
    if (!this.enabled)
      return {
        ...base,
        status: 'disabled',
        message: 'Provider usage checks are disabled on this server.',
      };
    try {
      const runtime = await this.runtime;
      const signal = AbortSignal.timeout(5000);
      if ((await runtime.checkAuth(provider, { signal }))?.type !== 'oauth')
        return {
          ...base,
          status: 'signin-required',
          message:
            'Subscription limits require a matching OAuth login in Pi. API-key token usage is not a 5-hour or weekly allowance.',
        };
      const auth = await runtime.getAuth(provider, { signal });
      const token = auth?.auth.apiKey;
      if (!token)
        return {
          ...base,
          status: 'signin-required',
          message: 'Pi could not resolve subscription credentials.',
        };
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (provider === 'openai-codex') {
        const id = accountId(token);
        if (id) headers['ChatGPT-Account-Id'] = id;
      } else headers['anthropic-beta'] = 'oauth-2025-04-20';
      const response = await this.fetcher(ENDPOINTS[provider], {
        headers,
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        return {
          ...base,
          status: 'unavailable',
          message: `The provider did not return usage limits (HTTP ${response.status}). Check your provider account or retry later.`,
        };
      }
      const windows = parseUsage(provider, await boundedJson(response));
      return windows.fiveHour || windows.weekly
        ? { ...base, ...windows, status: 'ok' }
        : {
            ...base,
            status: 'unavailable',
            message:
              'The provider did not report recognizable 5-hour or weekly limits. No estimate is shown.',
          };
    } catch {
      return {
        ...base,
        status: 'unavailable',
        message:
          'Usage limits could not be retrieved. The provider may be offline, your login may have expired, or its usage endpoint may be unavailable.',
      };
    }
  }
}
