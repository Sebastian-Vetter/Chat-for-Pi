export const REPOSITORY = 'Sebastian-Vetter/Chat-for-Pi';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isStableVersion(value: unknown): value is string {
  return typeof value === 'string' && STABLE_VERSION.test(value);
}

export function releaseArtifacts(version: string) {
  return {
    extension: `pi-chat-extension-${version}.tgz`,
    app: `pi-chat-app-${version}.tar.gz`,
  };
}

export function piInstallCommand(version: string) {
  return `pi install git:github.com/${REPOSITORY}@v${version}`;
}
