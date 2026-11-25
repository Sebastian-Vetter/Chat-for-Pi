import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatServerService, serviceConfig } from './service.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const service = new ChatServerService(serviceConfig(root));
const action = process.argv[2] ?? 'status';
const target = join(homedir(), '.pi', 'agent', 'extensions', 'pi-chat-server.ts');
const shim = `// Managed by Chat for Pi. Re-run npm run pi:install after moving the project.\nexport { default } from ${JSON.stringify(join(root, 'extensions', 'chat-server.ts'))};\n`;
try {
  switch (action) {
    case 'install': {
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, shim, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if ((await readFile(target, 'utf8')) !== shim)
          throw new Error(`Another extension already exists at ${target}. It was not overwritten.`);
      }
      console.log(
        `Installed Pi command: ${target}\nRun /reload in Pi, then /chat-server start.\nNo server has been started yet.`,
      );
      break;
    }
    case 'uninstall': {
      let content: string;
      try {
        content = await readFile(target, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log('Pi command is not installed.');
          break;
        }
        throw error;
      }
      if (content !== shim)
        throw new Error(`Refusing to remove an extension not owned by this checkout: ${target}`);
      await rm(target);
      console.log(
        'Pi command removed. Run /reload. To stop the server separately, run npm run server:stop.',
      );
      break;
    }
    case 'start':
    case 'restart': {
      const state = action === 'start' ? await service.start() : await service.restart();
      console.log(
        `Chat is running at ${state.url} (PID ${state.pid}).\nIt survives terminal closure and starts at login.\nLogs: ${state.logDir}`,
      );
      break;
    }
    case 'status':
      console.log(JSON.stringify(await service.status(), null, 2));
      break;
    case 'stop':
      await service.stop();
      console.log('Chat background server stopped. Login startup removed.');
      break;
    case 'open':
      await service.open();
      break;
    case 'logs':
      console.log(await service.logs());
      break;
    default:
      throw new Error(
        'Usage: chat-server.ts install | uninstall | start | status | stop | restart | open | logs',
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
