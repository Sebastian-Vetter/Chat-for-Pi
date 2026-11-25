import express from 'express';
import { realpath, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { ChatStore } from './store.js';
import { AgentService } from './agent.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const dataDir = resolve(process.env.CHAT_DATA_DIR ?? '.data');
const store = new ChatStore(dataDir);
const agents = new AgentService(store);
const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']);
app.use((req, res, next) => {
  if (!allowed.has(req.headers.host ?? '')) { res.status(403).json({ error: 'Local access only' }); return; }
  const origin = req.headers.origin;
  if (origin) {
    try { if (!allowed.has(new URL(origin).host) || new URL(origin).protocol !== 'http:') throw new Error(); }
    catch { res.status(403).json({ error: 'Origin not allowed' }); return; }
  }
  if (req.path.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    res.status(415).json({ error: 'Expected application/json' }); return;
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) => res.json({ app: 'pi-chat', pid: process.pid, serviceId: process.env.CHAT_SERVICE_ID ?? null }));
app.get('/api/config', async (_req, res) => {
  const runtime = await agents.runtime;
  const models = (await runtime.getAvailable()).map(m => ({ key: `${m.provider}/${m.id}`, name: m.name, provider: m.provider }));
  res.json({ defaultCwd: resolve(process.env.CHAT_WORKSPACE ?? '..'), home: homedir(), models });
});
app.get('/api/chats', (_req, res) => res.json(store.list()));
app.post('/api/chats', async (req, res) => {
  const input = req.body?.cwd;
  if (typeof input !== 'string' || !input.trim()) { res.status(400).json({ error: 'A working directory is required' }); return; }
  let cwd: string;
  try { cwd = await realpath(input.startsWith('~/') ? join(homedir(), input.slice(2)) : resolve(input)); if (!(await stat(cwd)).isDirectory()) throw new Error(); }
  catch { res.status(400).json({ error: 'Working directory does not exist or is not accessible' }); return; }
  res.status(201).json(store.create(cwd));
});
app.param('id', (req, res, next, id) => {
  if (!store.get(id)) { res.status(404).json({ error: 'Chat not found' }); return; } next();
});
app.get('/api/chats/:id', (req, res) => res.json(agents.snapshot(store.get(req.params.id)!)));
app.get('/api/chats/:id/instructions', (req, res) => res.json(agents.instructions(store.get(req.params.id)!)));
app.patch('/api/chats/:id', (req, res) => {
  const title = req.body?.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 120) { res.status(400).json({ error: 'Title must be 1–120 characters' }); return; }
  res.json(store.update(req.params.id, { title: title.trim() }));
});
app.delete('/api/chats/:id', async (req, res) => {
  const id = req.params.id;
  if (agents.busy(id)) { res.status(409).json({ error: 'Stop this chat before deleting it' }); return; }
  agents.dispose(id);
  await rm(join(dataDir, 'sessions', id), { recursive: true, force: true });
  store.delete(id); res.json({ ok: true });
});
app.get('/api/chats/:id/events', (req, res) => {
  const record = store.get(req.params.id)!;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (snapshot: unknown) => res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  const unsubscribe = agents.subscribe(record.id, send);
  send(agents.snapshot(record));
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});
app.post('/api/chats/:id/messages', (req, res) => {
  const record = store.get(req.params.id)!;
  if (agents.busy(record.id)) { res.status(409).json({ error: 'This chat is already running' }); return; }
  const text = req.body?.text;
  const model = req.body?.model;
  if (typeof text !== 'string' || !text.trim() || text.length > 100000 || (model !== undefined && typeof model !== 'string')) {
    res.status(400).json({ error: 'Message must contain 1–100,000 characters' }); return;
  }
  // Running state is set synchronously before acknowledging the request.
  void agents.prompt(record, text.trim(), model).catch(error => console.error('Agent failure:', error));
  res.status(202).json({ ok: true });
});
app.post('/api/chats/:id/stop', async (req, res) => { await agents.abort(req.params.id); res.json({ ok: true }); });
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown endpoint' }); });
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error.message);
  res.status(500).json({ error: error.message || 'Unexpected server error' });
});
const server = app.listen(port, '127.0.0.1', () => console.log(`Pi Chat API: http://127.0.0.1:${port}`));
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  server.close(); await agents.shutdown(); server.closeAllConnections(); process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
