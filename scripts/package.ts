import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { copyApplication } from './install-app.ts';
import { run } from './service.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) throw new Error('Packaging requires a stable semantic version.');
const output = resolve(root, '.release');
const directory = join(output, `pi-package-${pkg.version}`);
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await mkdir(join(directory, 'app'), { recursive: true });
await copyApplication(root, join(directory, 'app'));
await cp(join(root, 'dist'), join(directory, 'app', 'dist'), { recursive: true });
await build({ entryPoints: [join(root, 'extensions/distribution.ts')], outfile: join(directory, 'extensions/distribution.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' });
await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@sebastian-vetter/pi-chat', version: pkg.version, description: pkg.description,
  type: 'module', keywords: ['pi-package'], repository: pkg.repository, engines: pkg.engines,
  pi: { extensions: ['./extensions/distribution.mjs'], changelogPath: './CHANGELOG.md' }, peerDependencies: pkg.peerDependencies,
  files: ['extensions', 'app', 'README.md', 'CHANGELOG.md'] }, null, 2) + '\n');
for (const file of ['README.md', 'CHANGELOG.md']) await cp(join(root, file), join(directory, file));
const extension = `pi-chat-extension-${pkg.version}.tgz`, app = `pi-chat-app-${pkg.version}.tar.gz`;
// npm pack creates the required portable package/ archive prefix.
const packed = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], directory);
if (packed.code !== 0) throw new Error(packed.stderr || packed.stdout);
const filename = JSON.parse(packed.stdout)[0].filename;
const { rename } = await import('node:fs/promises');
await rename(join(output, filename), join(output, extension));
const archive = await run('tar', ['-czf', join(output, app), '-C', directory, 'app']);
if (archive.code !== 0) throw new Error(archive.stderr);
const sums = await Promise.all([extension, app].map(async file => `${createHash('sha256').update(await readFile(join(output, file))).digest('hex')}  ${file}`));
await writeFile(join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
const heading = `## [${pkg.version}]`;
const start = changelog.indexOf(heading);
if (start < 0) throw new Error(`Missing changelog entry for ${pkg.version}`);
const notes = changelog.slice(start).split(/\n## \[/)[0];
await writeFile(join(output, 'release-notes.md'), `${notes}\n\n## Install the Pi package\n\n\`\`\`sh\npi install git:github.com/Sebastian-Vetter/Chat-for-Pi@v${pkg.version}\n\`\`\`\n\nThen run \`/reload\` and \`/chat-server install\` in Pi. Review and confirm installation; no server starts automatically. macOS background service: \`/chat-server start\`, then \`/chat-server open\`.\n\nAlternatively download the extension tarball, verify SHA256SUMS, extract it, and use \`pi install ./package\`. Standalone application: extract the app archive, \`cd app\`, \`npm ci --include=dev\`, \`npm run build\`, \`npm start\` (Node.js 22.19+).\n\nUpdating an existing managed installation: finish active runs, explicitly stop the server, install the new Pi package and /reload, run /chat-server install, then /chat-server start. Session data stays outside application code. Existing checkout installations keep their original data and are not migrated automatically.\n`);
console.log(`Release artifacts prepared in ${output}:\n${extension}\n${app}\nSHA256SUMS\nNothing was published.`);
