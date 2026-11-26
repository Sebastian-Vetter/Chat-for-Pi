import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_SHARED_FILE = 8 * 1024 * 1024;
export function digest(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function overlaps(a: string, b: string) {
  return (
    a === b ||
    (!relative(a, b).startsWith('..') && !isAbsolute(relative(a, b))) ||
    (!relative(b, a).startsWith('..') && !isAbsolute(relative(b, a)))
  );
}

/** Files are scoped to one canonical root. Local agent tools remain trusted code, not a sandbox. */
export class SharedFiles {
  readonly root: string;
  constructor(root: string) {
    if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
      throw new Error('Choose a real project directory');
    this.root = realpathSync(root);
  }
  path(name: string, createParents = false) {
    if (typeof name !== 'string' || name.length > 1000 || /[\\:\0]/.test(name) || isAbsolute(name))
      throw new Error('Invalid shared file path');
    const parts = name ? name.split('/') : [];
    if (parts.some((part) => !part || part === '.' || part === '..'))
      throw new Error('Invalid shared file path');
    if (realpathSync(this.root) !== this.root || lstatSync(this.root).isSymbolicLink())
      throw new Error('Shared project root changed');
    let current = this.root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      if (!existsSync(current)) {
        // lstat also catches dangling links, unlike existsSync.
        try {
          if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not shared');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (createParents && index < parts.length - 1) mkdirSync(current, { mode: 0o700 });
        continue;
      }
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || realpathSync(current) !== current)
        throw new Error('Symbolic links are not shared');
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Not a directory');
    }
    return current;
  }
  list(name = '') {
    const folder = this.path(name);
    const entries = readdirSync(folder).sort();
    if (entries.length > 1000)
      throw new Error('Folder exceeds 1,000 entries; choose a smaller project');
    return entries.flatMap((entry) => {
      const stat = lstatSync(join(folder, entry));
      return stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())
        ? []
        : [{ name: entry, directory: stat.isDirectory(), size: stat.size }];
    });
  }
  read(name: string) {
    if (!name) throw new Error('Choose a file');
    const path = this.path(name);
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > MAX_SHARED_FILE)
        throw new Error('Choose a regular file up to 8 MiB');
      const buffer = Buffer.alloc(MAX_SHARED_FILE + 1);
      let size = 0;
      while (size < buffer.length) {
        const count = readSync(descriptor, buffer, size, buffer.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size > MAX_SHARED_FILE) throw new Error('Shared files are limited to 8 MiB');
      const bytes = buffer.subarray(0, size);
      return { data: bytes.toString('base64'), hash: digest(bytes) };
    } finally {
      closeSync(descriptor);
    }
  }
  write(name: string, data: string, expectedHash: unknown) {
    if (
      !name ||
      typeof data !== 'string' ||
      data.length > Math.ceil(MAX_SHARED_FILE / 3) * 4 ||
      data.length % 4 !== 0
    )
      throw new Error('Invalid file data (8 MiB maximum)');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_SHARED_FILE || bytes.toString('base64') !== data)
      throw new Error('Invalid file data (8 MiB maximum)');
    const path = this.path(name, true);
    const previous = existsSync(path) ? this.read(name).hash : null;
    if (expectedHash !== previous) throw new Error('File changed; reload before replacing it');
    const temporary = join(dirname(path), `.pi-upload-${randomUUID()}`);
    try {
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      this.path(name);
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return { hash: digest(bytes) };
  }
  remove(name: string, expectedHash: unknown) {
    if (!name || this.read(name).hash !== expectedHash)
      throw new Error('File changed; reload before deleting it');
    unlinkSync(this.path(name));
    return { ok: true };
  }
}

export function emptyProject(folder: string, occupied: string[]) {
  const candidate = resolve(folder);
  if (
    occupied.some((root) =>
      overlaps(existsSync(root) ? realpathSync(root) : resolve(root), candidate),
    )
  )
    throw new Error('Choose a separate project folder, not an existing conversation workspace');
  if (!existsSync(candidate)) mkdirSync(candidate, { mode: 0o700 });
  if (
    lstatSync(candidate).isSymbolicLink() ||
    !lstatSync(candidate).isDirectory() ||
    readdirSync(candidate).length
  )
    throw new Error('The shared project folder must be empty, including hidden files');
  const root = realpathSync(candidate);
  if (
    occupied.some((folder) =>
      overlaps(existsSync(folder) ? realpathSync(folder) : resolve(folder), root),
    )
  )
    throw new Error('Project folders must not overlap');
  return root;
}
