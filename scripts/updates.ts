import {
  isStableVersion,
  releaseArtifacts,
  REPOSITORY,
  RELEASES_URL,
  REPOSITORY_URL,
} from './release-info.ts';

const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MINUTE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const SUCCESS_CACHE_MS = 60 * MINUTE_MS;
const FAILURE_CACHE_MS = 5 * MINUTE_MS;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_NOTES_LENGTH = 32_000;

export interface UpdateStatus {
  current: string;
  status: 'available' | 'current' | 'unavailable' | 'disabled' | 'unpublished';
  checkedAt?: string;
  latest?: string;
  notes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  message?: string;
}

export function newerVersion(latest: string, current: string) {
  if (!isStableVersion(latest) || !isStableVersion(current)) return false;

  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  const firstDifference = latestParts.findIndex((part, index) => part !== currentParts[index]);

  return firstDifference >= 0 && latestParts[firstDifference] > currentParts[firstDifference];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readReleaseResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty release response.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Release response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {
      // The stream may already have been closed by an aborted request.
    });
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function describeRelease(release: unknown, current: string, checkedAt: string): UpdateStatus {
  const tag = isRecord(release) ? release.tag_name : undefined;
  const latest = typeof tag === 'string' ? tag.replace(/^v/, '') : '';

  if (
    !isRecord(release) ||
    !isStableVersion(latest) ||
    tag !== `v${latest}` ||
    release.draft ||
    release.prerelease
  ) {
    throw new Error('GitHub did not return a stable release.');
  }

  const asset = releaseArtifacts(latest).extension;
  const hasDownload =
    Array.isArray(release.assets) &&
    release.assets.some((item) => isRecord(item) && item.name === asset);

  return {
    current,
    status: newerVersion(latest, current) ? 'available' : 'current',
    checkedAt,
    latest,
    notes: typeof release.body === 'string' ? release.body.slice(0, MAX_NOTES_LENGTH) : '',
    releaseUrl: `${RELEASES_URL}/tag/v${latest}`,
    ...(hasDownload
      ? { downloadUrl: `${REPOSITORY_URL}/releases/download/v${latest}/${asset}` }
      : {}),
  };
}

export class UpdateChecker {
  private cached?: UpdateStatus;
  private expiresAt = 0;
  private lastAttemptAt = -Infinity;
  private pending?: Promise<UpdateStatus>;

  constructor(
    private readonly current: string,
    private readonly enabled = true,
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}

  check(manual = false): Promise<UpdateStatus> {
    if (!this.enabled) {
      return Promise.resolve({
        current: this.current,
        status: 'disabled',
        message: 'Update checks are disabled by CHAT_UPDATE_CHECK=0.',
      });
    }
    if (this.pending) return this.pending;

    const now = this.now();
    const cacheIsFresh = now < this.expiresAt && !manual;
    const isRateLimited = now - this.lastAttemptAt < MINUTE_MS;
    if (this.cached && (cacheIsFresh || isRateLimited)) return Promise.resolve(this.cached);

    this.lastAttemptAt = now;
    this.pending = this.load().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async fetchStatus(checkedAt: string): Promise<UpdateStatus> {
    const response = await this.request(API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Chat-for-Pi-update-check',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });

    if (response.status === 404) {
      return {
        current: this.current,
        status: 'unpublished',
        checkedAt,
        message: 'No public stable release has been published yet.',
      };
    }
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Try again later.`);

    return describeRelease(await readReleaseResponse(response), this.current, checkedAt);
  }

  private async load(): Promise<UpdateStatus> {
    const checkedAt = new Date(this.now()).toISOString();
    let result: UpdateStatus;

    try {
      result = await this.fetchStatus(checkedAt);
    } catch (error) {
      result = {
        current: this.current,
        status: 'unavailable',
        checkedAt,
        message: error instanceof Error ? error.message : 'Could not check for updates.',
      };
    }

    this.cached = result;
    this.expiresAt =
      this.now() + (result.status === 'unavailable' ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS);
    return result;
  }
}
