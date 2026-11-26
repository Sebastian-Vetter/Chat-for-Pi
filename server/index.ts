import express from 'express';
import { realpath, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ChatStore } from './store.js';
import { AgentService } from './agent.js';
import { changes, fileDiff } from './git.js';
import { discoverTasks, PipelineService } from './pipelines.js';
import { PiSessions } from './pi-sessions.js';
import { UpdateChecker } from '../scripts/updates.ts';
import { UsageLimitChecker, USAGE_PROVIDERS } from './usage-limits.js';
import { editPlan, PlanEditError } from './plans.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const dataDir = resolve(process.env.CHAT_DATA_DIR ?? '.data');
const store = new ChatStore(dataDir);
const agents = new AgentService(store);
const pipelines = new PipelineService(
  agents.activity,
  (record) => agents.publish(record),
  (record, task) =>
    agents.approvals.guard(record, 'configured_test', {
      command: task.command,
      executable: task.executable,
      args: task.args,
    }),
);
const piSessions = new PiSessions(store);
const usageLimits = new UsageLimitChecker(agents.runtime, process.env.CHAT_USAGE_CHECK !== '0');
const appVersion: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const updates = new UpdateChecker(appVersion, process.env.CHAT_UPDATE_CHECK !== '0');
const webPort = Number(process.env.CHAT_WEB_PORT ?? 5173);
const allowed = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  `127.0.0.1:${webPort}`,
  `localhost:${webPort}`,
]);
app.use((req, res, next) => {
  if (!allowed.has(req.headers.host ?? '')) {
    res.status(403).json({ error: 'Local access only' });
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!allowed.has(new URL(origin).host) || new URL(origin).protocol !== 'http:')
        throw new Error();
    } catch {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
  }
  if (
    req.path.startsWith('/api/') &&
    ['POST', 'PATCH', 'DELETE'].includes(req.method) &&
    !req.is('application/json')
  ) {
    res.status(415).json({ error: 'Expected application/json' });
    return;
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) =>
  res.json({ app: 'pi-chat', pid: process.pid, serviceId: process.env.CHAT_SERVICE_ID ?? null }),
);
app.get('/api/config', async (_req, res) => {
  const runtime = await agents.runtime;
  const models = (await runtime.getAvailable()).map((m) => ({
    key: `${m.provider}/${m.id}`,
    name: m.name,
    provider: m.provider,
  }));
  res.json({
    version: appVersion,
    defaultCwd: resolve(process.env.CHAT_WORKSPACE ?? '..'),
    home: homedir(),
    models,
    usageProviders: USAGE_PROVIDERS.filter((provider) => runtime.isUsingOAuth(provider)),
  });
});
app.get('/api/updates', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await updates.check());
});
app.post('/api/updates/check', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await updates.check(true));
});
app.post('/api/usage-limits/check', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const provider = USAGE_PROVIDERS.find((item) => item === req.body?.provider);
  if (!provider) {
    res.status(400).json({ error: 'Unsupported subscription provider' });
    return;
  }
  res.json(await usageLimits.check(provider));
});
app.get('/api/chats', (_req, res) => res.json(store.list()));
app.get('/api/pi-sessions', async (req, res) =>
  res.json(
    await piSessions.list(
      typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '',
      Math.max(0, Number(req.query.offset) || 0),
    ),
  ),
);
app.get('/api/pi-sessions/:key', async (req, res) =>
  res.json(await piSessions.preview(req.params.key)),
);
app.post('/api/pi-sessions/:key/import', async (req, res) =>
  res.status(201).json(await piSessions.import(req.params.key)),
);
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'initial', chats: agents.summariesList() });
  const unsubscribe = agents.subscribeAll((chat) => send({ type: 'chat', chat }));
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
app.post('/api/chats', async (req, res) => {
  const input = req.body?.cwd;
  if (typeof input !== 'string' || !input.trim()) {
    res.status(400).json({ error: 'A working directory is required' });
    return;
  }
  let cwd: string;
  try {
    cwd = await realpath(input.startsWith('~/') ? join(homedir(), input.slice(2)) : resolve(input));
    if (!(await stat(cwd)).isDirectory()) throw new Error();
  } catch {
    res.status(400).json({ error: 'Working directory does not exist or is not accessible' });
    return;
  }
  res.status(201).json(store.create(cwd));
});
app.param('id', (_req, res, next, id) => {
  if (!store.get(id)) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  next();
});
app.get('/api/chats/:id', (req, res) => res.json(agents.snapshot(store.get(req.params.id)!)));
app.get('/api/chats/:id/instructions', (req, res) =>
  res.json(agents.instructions(store.get(req.params.id)!)),
);
app.get('/api/chats/:id/changes', async (req, res) =>
  res.json(await changes(store.get(req.params.id)!.cwd)),
);
app.get('/api/chats/:id/diff', async (req, res) => {
  if (typeof req.query.path !== 'string') {
    res.status(400).json({ error: 'A changed file path is required' });
    return;
  }
  res.json(await fileDiff(store.get(req.params.id)!.cwd, req.query.path, req.query.full === '1'));
});
app.get('/api/chats/:id/tests', async (req, res) => {
  const record = store.get(req.params.id)!;
  const tasks = (await discoverTasks(record.cwd)).map(({ id, name, command }) => ({
    id,
    name,
    command,
  }));
  res.json({
    tasks,
    running: pipelines.busy(record.id),
    runs: agents.activity.list(record.id).filter((e) => e.type === 'test'),
  });
});
app.post('/api/chats/:id/tests', async (req, res) => {
  if (typeof req.body?.taskId !== 'string') {
    res.status(400).json({ error: 'A configured task ID is required' });
    return;
  }
  try {
    const id = await pipelines.start(store.get(req.params.id)!, req.body.taskId);
    res.status(202).json({ id });
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
  }
});
app.post('/api/chats/:id/tests/stop', async (req, res) => {
  agents.approvals.cancel(req.params.id);
  await pipelines.stop(req.params.id);
  res.json({ ok: true });
});
app.post('/api/chats/:id/approvals/:approvalId', (req, res) => {
  if (typeof req.body?.approved !== 'boolean') {
    res.status(400).json({ error: 'approved must be a boolean' });
    return;
  }
  if (!agents.approvals.decide(req.params.id, req.params.approvalId, req.body.approved)) {
    res.status(404).json({ error: 'Approval no longer pending in this conversation' });
    return;
  }
  res.json({ ok: true });
});
app.patch('/api/chats/:id/plan', (req, res) => {
  const record = store.get(req.params.id)!;
  try {
    const plan = editPlan(
      record.plan ?? [],
      record.planRevision ?? 0,
      req.body,
      agents.busy(record.id) || pipelines.busy(record.id),
    );
    const updated = store.update(record.id, { plan });
    agents.publish(updated);
    res.json(updated);
  } catch (error) {
    if (!(error instanceof PlanEditError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
});
app.patch('/api/chats/:id', (req, res) => {
  const body = req.body ?? {};
  const field = ['pinned', 'folder', 'approvalMode', 'plan'].find((key) =>
    Object.hasOwn(body, key),
  );
  if (field) {
    if (Object.keys(body).length !== 1) {
      res.status(400).json({ error: 'Send one metadata field at a time' });
      return;
    }
    if (field === 'folder') {
      if (typeof body.folder !== 'string' || body.folder.length > 80) {
        res.status(400).json({ error: 'Folder must contain at most 80 characters' });
        return;
      }
    } else if (field === 'plan') {
      if (
        !Array.isArray(body.plan) ||
        body.plan.length > 30 ||
        !body.plan.every(
          (step: { text?: unknown; status?: unknown } | null) =>
            step &&
            typeof step.text === 'string' &&
            !!step.text.trim() &&
            step.text.length <= 300 &&
            typeof step.status === 'string' &&
            ['pending', 'running', 'done'].includes(step.status),
        )
      ) {
        res.status(400).json({ error: 'Invalid task plan' });
        return;
      }
    } else if (typeof body[field] !== 'boolean') {
      res.status(400).json({ error: `${field} must be a boolean` });
      return;
    }
    if (
      (field === 'approvalMode' || field === 'plan') &&
      (agents.busy(req.params.id) || pipelines.busy(req.params.id))
    ) {
      res
        .status(409)
        .json({ error: 'Stop active work before changing the approval mode or editing the plan' });
      return;
    }
    const value =
      field === 'folder'
        ? body.folder.trim()
        : field === 'plan'
          ? body.plan.map((step: { text: string; status: string }) => ({
              text: step.text.trim(),
              status: step.status,
            }))
          : body[field];
    const record = store.update(req.params.id, { [field]: value });
    agents.publish(record);
    res.json(record);
    return;
  }
  if (Object.hasOwn(req.body ?? {}, 'archived')) {
    if (typeof req.body.archived !== 'boolean' || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'archived must be a boolean and sent on its own' });
      return;
    }
    const record = store.update(req.params.id, { archived: req.body.archived });
    agents.publish(record);
    res.json(record);
    return;
  }
  const title = req.body?.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 120) {
    res.status(400).json({ error: 'Title must be 1–120 characters' });
    return;
  }
  res.json(store.update(req.params.id, { title: title.trim() }));
});
app.delete('/api/chats/:id', async (req, res) => {
  const id = req.params.id;
  if (agents.busy(id) || pipelines.busy(id)) {
    res.status(409).json({ error: 'Stop this chat and its tests before deleting it' });
    return;
  }
  agents.dispose(id);
  await rm(join(dataDir, 'sessions', id), { recursive: true, force: true });
  agents.activity.delete(id);
  agents.queues.delete(id);
  store.delete(id);
  res.json({ ok: true });
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
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
app.post('/api/chats/:id/messages', (req, res) => {
  const record = store.get(req.params.id)!;
  const text = req.body?.text;
  const model = req.body?.model;
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > 100000 ||
    (model !== undefined && typeof model !== 'string')
  ) {
    res.status(400).json({ error: 'Message must contain 1–100,000 characters' });
    return;
  }
  if (req.body.enqueue === true) {
    try {
      agents.enqueue(record, text.trim(), model);
      res.status(202).json({ ok: true, queued: true });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
    return;
  }
  if (agents.busy(record.id)) {
    res.status(409).json({ error: 'This chat is already running. Queue the prompt instead.' });
    return;
  }
  // Running state is set synchronously before acknowledging the request.
  void agents
    .prompt(record, text.trim(), model)
    .catch((error) => console.error('Agent failure:', error));
  res.status(202).json({ ok: true });
});
app.patch('/api/chats/:id/queue', (req, res) => {
  if (typeof req.body?.paused !== 'boolean') {
    res.status(400).json({ error: 'paused must be a boolean' });
    return;
  }
  agents.pauseQueue(store.get(req.params.id)!, req.body.paused);
  res.json({ ok: true });
});
app.delete('/api/chats/:id/queue/:promptId', (req, res) => {
  agents.queues.remove(req.params.id, req.params.promptId);
  agents.publish(store.get(req.params.id)!);
  res.json({ ok: true });
});
app.post('/api/chats/:id/stop', async (req, res) => {
  await agents.abort(req.params.id);
  res.json({ ok: true });
});
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown endpoint' });
});
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error.message);
    res.status(500).json({ error: error.message || 'Unexpected server error' });
  },
);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Pi Chat API: http://127.0.0.1:${port}`),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await Promise.all([agents.shutdown(), pipelines.shutdown()]);
  server.closeAllConnections();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
