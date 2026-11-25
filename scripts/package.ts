import { build } from 'esbuild';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { copyApplication } from './install-app.ts';
import { npmCommand, run } from './process.ts';
import { isStableVersion, piInstallCommand, releaseArtifacts } from './release-info.ts';

type PackageMetadata = Pick<
  typeof import('../package.json'),
  'version' | 'description' | 'repository' | 'engines' | 'peerDependencies'
>;

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageMetadata;
if (!isStableVersion(pkg.version)) throw new Error('Packaging requires a stable semantic version.');

const output = resolve(root, '.release');
const directory = join(output, `pi-package-${pkg.version}`);
const artifacts = releaseArtifacts(pkg.version);

async function preparePackage() {
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, 'app'), { recursive: true });
  await copyApplication(root, join(directory, 'app'));
  await cp(join(root, 'dist'), join(directory, 'app', 'dist'), { recursive: true });

  await build({
    entryPoints: [join(root, 'extensions/distribution.ts')],
    outfile: join(directory, 'extensions/distribution.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
  });

  const manifest = {
    name: '@sebastian-vetter/pi-chat',
    version: pkg.version,
    description: pkg.description,
    type: 'module',
    keywords: ['pi-package'],
    repository: pkg.repository,
    engines: pkg.engines,
    pi: { extensions: ['./extensions/distribution.mjs'], changelogPath: './CHANGELOG.md' },
    peerDependencies: pkg.peerDependencies,
    files: ['extensions', 'app', 'README.md', 'CHANGELOG.md'],
  };
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const file of ['README.md', 'CHANGELOG.md']) {
    await cp(join(root, file), join(directory, file));
  }
}

async function createArchives() {
  // npm pack creates the required portable package/ archive prefix.
  const packed = await run(
    npmCommand,
    ['pack', '--ignore-scripts', '--json', '--pack-destination', output],
    directory,
  );
  if (packed.code !== 0) throw new Error(packed.stderr || packed.stdout);

  const packages = JSON.parse(packed.stdout) as { filename: string }[];
  await rename(join(output, packages[0].filename), join(output, artifacts.extension));

  const archive = await run('tar', ['-czf', join(output, artifacts.app), '-C', directory, 'app']);
  if (archive.code !== 0) throw new Error(archive.stderr);
}

async function writeChecksums() {
  const checksums = await Promise.all(
    Object.values(artifacts).map(async (file) => {
      const content = await readFile(join(output, file));
      const checksum = createHash('sha256').update(content).digest('hex');
      return `${checksum}  ${file}`;
    }),
  );
  await writeFile(join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
}

async function writeReleaseNotes() {
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf(`## [${pkg.version}]`);
  if (start < 0) throw new Error(`Missing changelog entry for ${pkg.version}`);
  const notes = changelog.slice(start).split(/\n## \[/)[0];

  const installationGuide = `## Install the Pi package

\`\`\`sh
${piInstallCommand(pkg.version)}
\`\`\`

Then run \`/reload\` and \`/chat-server install\` in Pi. Review and confirm installation; no server starts automatically. macOS background service: \`/chat-server start\`, then \`/chat-server open\`.

Alternatively download the extension tarball, verify SHA256SUMS, extract it, and use \`pi install ./package\`. Standalone application: extract the app archive, \`cd app\`, \`npm ci --include=dev\`, \`npm run build\`, \`npm start\` (Node.js 22.19+).

Updating an existing managed installation: finish active runs, explicitly stop the server, install the new Pi package and /reload, run /chat-server install, then /chat-server start. Session data stays outside application code. Existing checkout installations keep their original data and are not migrated automatically.
`;
  await writeFile(join(output, 'release-notes.md'), `${notes}\n\n${installationGuide}`);
}

await preparePackage();
await createArchives();
await writeChecksums();
await writeReleaseNotes();
console.log(
  `Release artifacts prepared in ${output}:\n${artifacts.extension}\n${artifacts.app}\nSHA256SUMS\nNothing was published.`,
);
