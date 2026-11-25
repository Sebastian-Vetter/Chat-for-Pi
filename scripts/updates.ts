export const REPOSITORY = 'Sebastian-Vetter/Chat-for-Pi';
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newerVersion(latest: string, current: string) {
  if (!stable.test(latest) || !stable.test(current)) return false;
  const a = latest.split('.').map(Number), b = current.split('.').map(Number);
  const index = a.findIndex((part, i) => part !== b[i]);
  return index >= 0 && a[index] > b[index];
}
export interface UpdateStatus {
  current: string; status: 'available' | 'current' | 'unavailable' | 'disabled' | 'unpublished';
  checkedAt?: string; latest?: string; notes?: string; releaseUrl?: string; downloadUrl?: string; message?: string;
}
export class UpdateChecker {
  private cached?: UpdateStatus;
  private expires = 0;
  private lastAttempt = -Infinity;
  private pending?: Promise<UpdateStatus>;
  constructor(private current: string, private enabled = true, private request: typeof fetch = fetch, private now = Date.now) {}
  check(manual = false): Promise<UpdateStatus> {
    if (!this.enabled) return Promise.resolve({ current: this.current, status: 'disabled', message: 'Update checks are disabled by CHAT_UPDATE_CHECK=0.' });
    if (this.pending) return this.pending;
    if (this.cached && (this.now() < this.expires && !manual || this.now() - this.lastAttempt < 60000)) return Promise.resolve(this.cached);
    this.lastAttempt = this.now();
    this.pending = this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async load(): Promise<UpdateStatus> {
    const checkedAt = new Date(this.now()).toISOString();
    let result: UpdateStatus;
    try {
      const response = await this.request(API_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Chat-for-Pi-update-check', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (response.status === 404) result = { current: this.current, status: 'unpublished', checkedAt, message: 'No public stable release has been published yet.' };
      else {
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Try again later.`);
        if (!response.body) throw new Error('Empty release response.');
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw new Error('Release response is too large.'); chunks.push(value); } }
        finally { await reader.cancel().catch(() => {}); }
        const release = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const latest = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
        if (!stable.test(latest) || release.tag_name !== `v${latest}` || release.draft || release.prerelease) throw new Error('GitHub did not return a stable release.');
        const releaseUrl = `${RELEASES_URL}/tag/v${latest}`;
        const asset = `pi-chat-extension-${latest}.tgz`;
        const hasDownload = Array.isArray(release.assets) && release.assets.some((item: { name?: unknown }) => item?.name === asset);
        result = { current: this.current, status: newerVersion(latest, this.current) ? 'available' : 'current', checkedAt, latest,
          notes: typeof release.body === 'string' ? release.body.slice(0, 32000) : '', releaseUrl,
          ...(hasDownload ? { downloadUrl: `https://github.com/${REPOSITORY}/releases/download/v${latest}/${asset}` } : {}) };
      }
    } catch (error) { result = { current: this.current, status: 'unavailable', checkedAt, message: error instanceof Error ? error.message : 'Could not check for updates.' }; }
    this.cached = result;
    this.expires = this.now() + (result.status === 'unavailable' ? 5 * 60000 : 60 * 60000);
    return result;
  }
}
