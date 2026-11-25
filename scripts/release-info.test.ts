import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStableVersion,
  piInstallCommand,
  releaseArtifacts,
  REPOSITORY,
  RELEASES_URL,
} from './release-info.ts';

test('release metadata uses one repository and consistent artifact and installation names', () => {
  const version = '2.10.3';
  assert.equal(RELEASES_URL, `https://github.com/${REPOSITORY}/releases`);
  assert.deepEqual(releaseArtifacts(version), {
    extension: 'pi-chat-extension-2.10.3.tgz',
    app: 'pi-chat-app-2.10.3.tar.gz',
  });
  assert.equal(piInstallCommand(version), `pi install git:github.com/${REPOSITORY}@v${version}`);
});

test('stable version validation rejects malformed and non-string metadata', () => {
  for (const value of ['0.0.0', '1.0.6', '12.345.678']) assert.equal(isStableVersion(value), true);
  for (const value of [
    null,
    undefined,
    106,
    {},
    '01.0.0',
    'v1.0.6',
    '1.0',
    '1.0.6-beta',
    '../1.0.6',
  ]) {
    assert.equal(isStableVersion(value), false);
  }
});
