import { execFile } from 'node:child_process';
import { lstat, open, readlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

function git(cwd: string, args: string[]) {
  return new Promise<string>((ok, fail) => execFile('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) fail(new Error(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'Diff exceeds the 2 MB display limit. Narrow the changes or use your terminal.' : stderr.trim() || error.message)); else ok(stdout);
  }));
}
export interface ChangedFile { path: string; oldPath?: string; status: string; staged: boolean; untracked: boolean }
export function parseStatus(text: string): ChangedFile[] {
  const parts = text.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]; if (!part) continue;
    const status = part.slice(0, 2), path = part.slice(3);
    const oldPath = /[RC]/.test(status) ? parts[++i] : undefined;
    files.push({ path, oldPath, status: status.trim(), staged: status[0] !== ' ' && status[0] !== '?', untracked: status === '??' });
  }
  return files;
}
export async function changes(cwd: string) {
  let root: string;
  try { root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim(); }
  catch { return { available: false, root: '', branch: '', files: [] as ChangedFile[], note: 'This workspace is not an accessible Git repository.' }; }
  const files = parseStatus(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const branch = await git(root, ['symbolic-ref', '--short', 'HEAD']).then(s => s.trim()).catch(() => 'detached HEAD');
  return { available: true, root, branch, files, note: '' };
}
export async function fileDiff(cwd: string, path: string, full = false) {
  const state = await changes(cwd);
  const file = state.files.find(f => f.path === path);
  if (!file) throw new Error('This file is not in the current Git change list. Refresh Changes.');
  const hasHead = await git(state.root, ['rev-parse', '--verify', 'HEAD']).then(() => true).catch(() => false);
  let patch: string;
  if (file.untracked || (!hasHead && !file.status.includes('D'))) {
    const absolute = resolve(state.root, path);
    if (!absolute.startsWith(state.root + sep)) throw new Error('Invalid repository path');
    const info = await lstat(absolute);
    let text: string;
    if (info.isSymbolicLink()) text = await readlink(absolute);
    else {
      if (!info.isFile()) throw new Error('This path is not a regular file.');
      if (info.size > 1024 * 1024) throw new Error('New file exceeds the 1 MB display limit.');
      const handle = await open(absolute, 'r');
      try {
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024 * 1024) throw new Error('New file exceeds the 1 MB display limit.');
        text = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await handle.close(); }
    }
    if (text.includes('\0')) patch = `Binary file ${path} (content not displayed)`;
    else {
      const lines = text ? text.replace(/\n$/, '').split('\n') : [];
      patch = `diff --git a/${path} b/${path}\nnew file\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}${text && !text.endsWith('\n') ? '\n\\ No newline at end of file' : ''}`;
    }
  } else {
    patch = await git(state.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', `--unified=${full ? '100000' : '3'}`, ...(hasHead ? ['HEAD'] : []), '--', ...(file.oldPath ? [file.oldPath] : []), path]);
    if (!patch) patch = 'No content diff. This may be a mode-only change, a submodule, or an unchanged staged/working-tree combination.';
  }
  const lines = patch.split('\n');
  return { path, patch, additions: lines.filter(s => s.startsWith('+') && !s.startsWith('+++')).length, deletions: lines.filter(s => s.startsWith('-') && !s.startsWith('---')).length };
}
