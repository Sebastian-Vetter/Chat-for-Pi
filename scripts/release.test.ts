import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
test('release preparation rejects empty notes, then bumps package, lock and changelog together', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-release-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const file of ['release.ts', 'release-info.ts']) {
      copyFileSync(new URL(`./${file}`, import.meta.url), join(dir, 'scripts', file));
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module' }));
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }),
    );
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n\nInitial release.\n',
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
          join(dir, 'scripts/release.ts'),
          'patch',
        ],
        { encoding: 'utf8' },
      );
    assert.equal(run().status, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.0.0');
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Example fix.\n\n## [1.0.0]\n\nInitial release.\n',
    );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.0.1');
    assert.equal(
      JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version,
      '1.0.1',
    );
    assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), /## \[1\.0\.1\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
