import express from 'express';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SharedService, type SharedRole } from './shared.js';
import { lanAddresses, parseInvite, remoteCall, SharedNetwork } from './shared-network.js';

export function sharedRoutes(shared: SharedService, network: SharedNetwork) {
  const router = express.Router();
  const route =
    (fn: (req: express.Request) => unknown | Promise<unknown>): express.RequestHandler =>
    async (req, res) => {
      try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await fn(req));
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : 'Shared operation failed' });
      }
    };
  router.get(
    '/identity',
    route(() => shared.identity.public()),
  );
  router.patch(
    '/identity',
    route((req) => shared.identity.rename(req.body?.name)),
  );
  router.get(
    '/sessions',
    route(() => shared.list()),
  );
  router.post(
    '/sessions',
    route((req) => {
      const folder = req.body?.folder;
      return shared.create(
        typeof folder === 'string' && folder.startsWith('~/')
          ? join(homedir(), folder.slice(2))
          : folder,
        req.body?.title,
        req.body?.trustWriters,
      );
    }),
  );
  router.patch(
    '/sessions/:id/access',
    route((req) => shared.access(String(req.params.id), req.body?.enabled)),
  );
  router.post(
    '/sessions/:id/invite',
    route((req) => network.invite(String(req.params.id), req.body?.role as SharedRole)),
  );
  router.patch(
    '/sessions/:id/members/:memberId',
    route((req) =>
      shared.member(String(req.params.id), String(req.params.memberId), req.body?.role),
    ),
  );
  router.get(
    '/network',
    route(() => network.status()),
  );
  router.post(
    '/network',
    route((req) => {
      if (req.body?.enabled === false) return network.stop();
      if (
        req.body?.enabled !== true ||
        !lanAddresses().some((item) => item.address === req.body?.address)
      )
        throw new Error('Choose one of this computer’s private LAN addresses');
      return network.start(req.body.address);
    }),
  );
  router.post(
    '/join',
    route(async (req) => {
      const invite = parseInvite(req.body?.link);
      shared.assertKnownOwner(invite);
      if (invite.ownerId === shared.identity.public().id)
        throw new Error('This is your own shared session; open it in Shared');
      const response = (await remoteCall(
        invite,
        invite.token,
        shared.signed(invite.sessionId, invite.token, 'join', {}),
      )) as { token: string; title: string; ownerId: string };
      if (
        response.ownerId !== invite.ownerId ||
        typeof response.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(response.token) ||
        typeof response.title !== 'string' ||
        response.title.length > 120
      )
        throw new Error('Invalid shared owner response');
      return shared.addRemote(invite, response.token, response.title);
    }),
  );
  router.delete(
    '/joined/:id',
    route((req) => shared.forgetRemote(String(req.params.id))),
  );
  router.post(
    '/joined/:id/rpc',
    route((req) => {
      const remote = shared.remote(String(req.params.id));
      if (!['snapshot', 'list', 'read', 'write', 'remove', 'message'].includes(req.body?.operation))
        throw new Error('Unsupported shared operation');
      return remoteCall(
        remote.invite,
        remote.token,
        shared.signed(
          remote.invite.sessionId,
          remote.token,
          req.body.operation,
          req.body.data ?? {},
        ),
      );
    }),
  );
  router.post(
    '/sessions/:id/files',
    route((req) => {
      const files = shared.files(String(req.params.id));
      const { operation, path, data, hash } = req.body ?? {};
      if (operation === 'list') return files.list(path ?? '');
      if (typeof path !== 'string') throw new Error('Choose a file');
      if (operation === 'read') return files.read(path);
      if (operation === 'write') return files.write(path, data, hash);
      if (operation === 'remove') return files.remove(path, hash);
      throw new Error('Unsupported file operation');
    }),
  );
  return router;
}
