import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
try {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const current = pkg.version.split('.').map(Number) as number[];
  const input = process.argv[2];
  if (!input) throw new Error('Usage: npm run release -- patch | minor | major | X.Y.Z');
  let version = input;
  if (['patch', 'minor', 'major'].includes(input)) {
    const next = [...current]; const index = { major: 0, minor: 1, patch: 2 }[input as 'major' | 'minor' | 'patch'];
    next[index]++; for (let i = index + 1; i < 3; i++) next[i] = 0; version = next.join('.');
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Use a stable semantic version such as 1.0.1.');
  const parts = version.split('.').map(Number); const firstDifference = parts.findIndex((n, i) => n !== current[i]);
  if (firstDifference < 0 || parts[firstDifference] < current[firstDifference]) throw new Error('The new version must be greater than the current version.');
  const path = new URL('CHANGELOG.md', root), changelog = readFileSync(path, 'utf8');
  const match = /## \[Unreleased\][^\S\r\n]*\r?\n([\s\S]*?)(?=\r?\n## \[|$)/.exec(changelog);
  if (!match?.[1].trim()) throw new Error('Add release notes under ## [Unreleased] in CHANGELOG.md before releasing.');
  const updated = changelog.replace(match[0], `## [Unreleased]\n\n## [${version}] - ${new Date().toISOString().slice(0, 10)}\n\n${match[1].trim()}\n`);
  const lockPath = new URL('package-lock.json', root), lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  pkg.version = version; lock.version = version; lock.packages[''].version = version;
  writeFileSync(path, updated); writeFileSync(new URL('package.json', root), JSON.stringify(pkg, null, 2) + '\n'); writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`Prepared ${version} in ${fileURLToPath(root)}. Review and commit the files; no Git commit, tag, or push was created.`);
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
