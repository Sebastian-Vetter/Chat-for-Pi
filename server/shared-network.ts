import https from 'node:https';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import express from 'express';
import type { SharedInvite, SharedTarget, SignedRequest } from './shared.js';
import { SharedAccessClient } from './shared-access-client.js';
import { SharedService, invitationMessage } from './shared.js';
import { proof, validPeer } from './shared-identity.js';

const GROUP = '239.255.67.89';
const DISCOVERY_PORT = 45478;
export function privateAddress(address: string) {
  return isIP(address) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(address);
}
export function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, items]) =>
    (items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal && privateAddress(item.address))
      .map((item) => ({ name, address: item.address })),
  );
}
export function parseInvite(input: string): SharedInvite {
  if (typeof input !== 'string' || input.length > 12000) throw new Error('Invalid invitation');
  const url = new URL(input);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search
  )
    throw new Error('Invalid local Chat for Pi invitation link');
  const encoded = new URLSearchParams(url.hash.slice(1)).get('join');
  if (!encoded) throw new Error('Paste a Chat for Pi invitation link');
  const invite = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SharedInvite;
  validateTarget(invite);
  if (
    invite.version !== 1 ||
    typeof invite.token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(invite.token) ||
    typeof invite.ownerId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(invite.ownerId) ||
    typeof invite.sessionId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(invite.sessionId)
  )
    throw new Error('Invalid invitation');
  validPeer(invite.owner);
  if (
    invite.owner.id !== invite.ownerId ||
    !proof(invite.owner.publicKey, invitationMessage(invite), invite.ownerProof)
  )
    throw new Error('Invalid signed owner invitation');
  return {
    version: 1,
    endpoint: invite.endpoint,
    certificate: invite.certificate,
    sessionId: invite.sessionId,
    token: invite.token,
    ownerId: invite.ownerId,
    owner: { id: invite.owner.id, name: invite.owner.name, publicKey: invite.owner.publicKey },
    ownerProof: invite.ownerProof,
  };
}
function validateTarget(target: { endpoint: string; certificate: string }) {
  if (
    typeof target.endpoint !== 'string' ||
    typeof target.certificate !== 'string' ||
    target.certificate.length > 8000
  )
    throw new Error('Invalid shared endpoint');
  const url = new URL(target.endpoint);
  if (
    url.protocol !== 'https:' ||
    !privateAddress(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Only HTTPS endpoints at literal private LAN IPv4 addresses are supported');
  new X509Certificate(target.certificate);
}
export function remoteCall(
  target: { endpoint: string; certificate: string },
  token: string,
  envelope: SignedRequest,
  surface: 'rpc' | 'access' = 'rpc',
): Promise<unknown> {
  validateTarget(target);
  const body = JSON.stringify(envelope);
  if (Buffer.byteLength(body) > (surface === 'access' ? 24 * 1024 : 12 * 1024 * 1024))
    throw new Error('Shared request too large');
  const expected = new X509Certificate(target.certificate).fingerprint256;
  return new Promise((resolve, reject) => {
    const request = https.request(
      new URL(surface, target.endpoint),
      {
        method: 'POST',
        ca: target.certificate,
        rejectUnauthorized: true,
        agent: false,
        checkServerIdentity: (_host, cert) =>
          cert.fingerprint256 === expected
            ? undefined
            : new Error('Shared owner certificate changed'),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > (surface === 'access' ? 64 * 1024 : 14 * 1024 * 1024))
            response.destroy(new Error('Shared response too large'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200)
              throw new SharedResponseError(
                result.error ?? 'Shared request rejected',
                response.statusCode ?? 0,
              );
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(10000, () =>
      request.destroy(new Error('Shared owner is offline or timed out')),
    );
    const deadline = setTimeout(
      () => request.destroy(new Error('Shared request deadline exceeded')),
      15000,
    );
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
    request.end(body);
  });
}

class SharedResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class SharedNetwork {
  private server?: https.Server;
  private socket?: dgram.Socket;
  private timer?: ReturnType<typeof setInterval>;
  private starting = false;
  private address = '';
  private port = 0;
  private certificate = '';
  private found = new Map<
    string,
    {
      id: string;
      name: string;
      address: string;
      sessions: { id: string; title: string }[];
      expires: number;
      target?: Omit<SharedTarget, 'sessionId'>;
    }
  >();
  private recovering = new Map<string, Promise<void>>();
  readonly access: SharedAccessClient;
  constructor(private shared: SharedService) {
    this.access = new SharedAccessClient(shared, (target, request) =>
      remoteCall(target, '', request, 'access'),
    );
  }
  async proxy(id: string, operation: string, data: Record<string, unknown>) {
    if (!['snapshot', 'list', 'read', 'write', 'remove', 'message', 'typing'].includes(operation))
      throw new Error('Unsupported shared operation');
    const remote = this.shared.remote(id);
    const invoke = (token: string) =>
      remoteCall(
        remote.invite,
        token,
        this.shared.signed(remote.invite.sessionId, token, operation, data),
      );
    const token = remote.token;
    try {
      return await invoke(token);
    } catch (error) {
      // Only retry read-only snapshots, never a prompt, file mutation or typing announcement.
      if (
        operation !== 'snapshot' ||
        !(error instanceof SharedResponseError) ||
        error.status !== 403 ||
        !(
          error.message === 'Authentication required' || error.message.startsWith('Access revoked;')
        )
      )
        throw error;
      if (remote.token === token) {
        let pending = this.recovering.get(id);
        if (!pending) {
          pending = this.access.renew(id);
          this.recovering.set(id, pending);
        }
        try {
          await pending;
        } finally {
          if (this.recovering.get(id) === pending) this.recovering.delete(id);
        }
      }
      return invoke(this.shared.remote(id).token);
    }
  }
  async requestAccess(ownerId: string, sessionId: string) {
    const peer = this.found.get(ownerId);
    const session = peer?.sessions.find((session) => session.id === sessionId);
    if (!peer || peer.expires < Date.now() || !session)
      throw new Error('Session is no longer discovered; refresh discovery');
    if (!peer.target)
      throw new Error(
        'The owner needs an updated app for access requests; use an invitation instead',
      );
    await this.access.request({ ...peer.target, sessionId }, session.title);
    return this.status();
  }
  status() {
    for (const [id, peer] of this.found) if (peer.expires < Date.now()) this.found.delete(id);
    return {
      enabled: !!this.server?.listening,
      address: this.address,
      port: this.port,
      addresses: lanAddresses(),
      peers: [...this.found.values()].map(({ expires: _expiry, target, ...peer }) => ({
        ...peer,
        canRequest: !!target,
      })),
      requests: this.access.list(),
    };
  }
  async start(address: string, port = 45479, discover = true) {
    if (this.starting || this.server) throw new Error('LAN sharing is already enabled or starting');
    if (!privateAddress(address) || !Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error('Choose a private LAN IPv4 address and port');
    if (!this.shared.identity.public().name) throw new Error('Choose your display name first');
    this.starting = true;
    try {
      const keyPath = join(this.shared.store.directory, 'lan-key.pem');
      const certPath = join(this.shared.store.directory, 'lan-cert.pem');
      let needsCertificate = true;
      try {
        needsCertificate =
          !existsSync(keyPath) ||
          !existsSync(certPath) ||
          new Date(new X509Certificate(readFileSync(certPath)).validTo).getTime() <= Date.now();
      } catch {
        /* Retry a previously interrupted certificate generation. */
      }
      if (needsCertificate) {
        writeFileSync(keyPath, '', { mode: 0o600 });
        writeFileSync(certPath, '', { mode: 0o600 });
        try {
          execFileSync(
            'openssl',
            [
              'req',
              '-x509',
              '-newkey',
              'rsa:2048',
              '-nodes',
              '-sha256',
              '-keyout',
              keyPath,
              '-out',
              certPath,
              '-days',
              '365',
              '-subj',
              '/CN=ChatForPi-LAN',
            ],
            { timeout: 20000, stdio: 'pipe' },
          );
        } catch {
          throw new Error(
            'LAN sharing needs OpenSSL to create its local TLS certificate. Install OpenSSL and try again.',
          );
        }
      }
      this.certificate = readFileSync(certPath, 'utf8');
      const app = express();
      const limits = new Map<string, { count: number; until: number }>();
      app.use((req, res, next) => {
        if (
          !privateAddress(req.socket.remoteAddress ?? '') ||
          req.headers.origin ||
          req.headers.host !== `${this.address}:${this.port}`
        ) {
          res
            .status(403)
            .json({ error: 'Only authenticated Chat for Pi peers may use this endpoint' });
          return;
        }
        for (const [key, state] of limits) if (state.until < Date.now()) limits.delete(key);
        const ip = req.socket.remoteAddress ?? '';
        const state = limits.get(ip) ?? { count: 0, until: Date.now() + 60000 };
        if (limits.size > 200 || ++state.count > 120) {
          res.status(429).json({ error: 'Shared request limit reached' });
          return;
        }
        limits.set(ip, state);
        if (
          req.method === 'POST' &&
          req.path === '/access' &&
          req.is('application/json') &&
          !req.headers['content-encoding']
        ) {
          next();
          return;
        }
        if (
          !/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization ?? '') ||
          !this.shared.acceptsCapability(req.headers.authorization!.slice(7)) ||
          !req.is('application/json') ||
          req.headers['content-encoding']
        ) {
          res.status(403).json({ error: 'Authentication required' });
          return;
        }
        next();
      });
      app.post('/access', express.json({ limit: '24kb', inflate: false }), (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
          res.json(this.shared.accessRPC(req.body));
        } catch (error) {
          res
            .status(403)
            .json({ error: error instanceof Error ? error.message : 'Access request rejected' });
        }
      });
      app.use(express.json({ limit: '12mb', inflate: false }));
      app.post('/rpc', (req, res) => {
        try {
          res.setHeader('Cache-Control', 'no-store');
          res.json(this.shared.rpc(req.body, req.headers.authorization!.slice(7)));
        } catch (error) {
          res
            .status(403)
            .json({ error: error instanceof Error ? error.message : 'Shared request rejected' });
        }
      });
      app.use((_req, res) =>
        res.status(404).json({ error: 'This is not the private application server' }),
      );
      app.use(
        (
          error: unknown,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) =>
          res.status(400).json({
            error:
              error instanceof SyntaxError
                ? 'Invalid shared request'
                : 'Shared request rejected or too large',
          }),
      );
      const server = https.createServer(
        { key: readFileSync(keyPath), cert: this.certificate, minVersion: 'TLSv1.2' },
        app,
      );
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      server.maxConnections = 50;
      this.server = server;
      await new Promise<void>((resolve, reject) => {
        const cancelled = () => reject(new Error('LAN startup was cancelled'));
        server.once('close', cancelled);
        server.once('error', reject);
        server.listen(port, address, () => {
          server.off('close', cancelled);
          resolve();
        });
      });
      if (this.server !== server) throw new Error('LAN startup was cancelled');
      this.address = address;
      this.port = (server.address() as { port: number }).port;
      if (discover) this.discovery();
      return this.status();
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      this.starting = false;
    }
  }
  invite(id: string, role: 'reader' | 'writer') {
    if (!this.server?.listening) throw new Error('Enable LAN sharing first');
    const unsigned: Omit<SharedInvite, 'ownerProof'> = {
      version: 1,
      endpoint: `https://${this.address}:${this.port}/`,
      certificate: this.certificate,
      sessionId: id,
      ownerId: this.shared.identity.public().id,
      owner: this.shared.identity.public(),
      token: this.shared.invitation(id, role),
    };
    const invitation: SharedInvite = {
      ...unsigned,
      ownerProof: this.shared.identity.sign(invitationMessage(unsigned)),
    };
    return {
      link: `http://127.0.0.1:3001/#join=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    };
  }
  advertisement() {
    if (!this.server?.listening) throw new Error('Enable LAN sharing first');
    const payload = JSON.stringify({
      version: 1,
      at: Date.now(),
      peer: this.shared.identity.public(),
      sessions: this.shared.advertisements(),
      endpoint: `https://${this.address}:${this.port}/`,
      certificate: this.certificate,
    });
    return Buffer.from(JSON.stringify({ payload, signature: this.shared.identity.sign(payload) }));
  }
  observe(bytes: Buffer, address: string) {
    if (bytes.length > 8000 || !privateAddress(address)) return;
    try {
      const envelope = JSON.parse(bytes.toString('utf8'));
      const value = JSON.parse(envelope.payload);
      validPeer(value.peer);
      if (
        value.version !== 1 ||
        !Number.isSafeInteger(value.at) ||
        Math.abs(Date.now() - value.at) > 15000 ||
        !proof(value.peer.publicKey, envelope.payload, envelope.signature) ||
        value.peer.id === this.shared.identity.public().id ||
        !Array.isArray(value.sessions) ||
        value.sessions.length > 20 ||
        value.sessions.some(
          (item: { id: string; title: string }) =>
            typeof item.id !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(item.id) ||
            typeof item.title !== 'string' ||
            item.title.length > 120,
        )
      )
        return;
      let target: Omit<SharedTarget, 'sessionId'> | undefined;
      if (value.endpoint !== undefined || value.certificate !== undefined) {
        validateTarget(value);
        if (new URL(value.endpoint).hostname !== address) return;
        target = {
          endpoint: value.endpoint,
          certificate: value.certificate,
          ownerId: value.peer.id,
          owner: { id: value.peer.id, name: value.peer.name, publicKey: value.peer.publicKey },
        };
      }
      if (this.found.size >= 100 && !this.found.has(value.peer.id)) return;
      this.found.set(value.peer.id, {
        id: value.peer.id,
        name: value.peer.name,
        address,
        sessions: value.sessions.map((session: { id: string; title: string }) => ({
          id: session.id,
          title: session.title,
        })),
        target,
        expires: Date.now() + 12000,
      });
    } catch {
      /* Untrusted discovery never grants access. */
    }
  }
  private discovery() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('error', () => {
      if (this.socket === socket) {
        this.socket = undefined;
        try {
          socket.close();
        } catch {
          /* Already closed. */
        }
      }
    });
    socket.on('message', (bytes, sender) => this.observe(bytes, sender.address));
    socket.bind(DISCOVERY_PORT, () => {
      if (this.socket !== socket) return;
      try {
        socket.addMembership(GROUP, this.address);
        socket.setMulticastInterface(this.address);
        socket.setMulticastTTL(1);
      } catch {
        if (this.socket === socket) this.socket = undefined;
        try {
          socket.close();
        } catch {
          /* Already closed. */
        }
      }
    });
    const announce = () => {
      if (!this.socket) return;
      if (!this.server?.listening) return;
      const bytes = this.advertisement();
      if (bytes.length <= 8000) {
        try {
          this.socket.send(bytes, DISCOVERY_PORT, GROUP, () => {});
        } catch {
          /* Discovery is best-effort; invitation links still work. */
        }
      }
    };
    this.timer = setInterval(announce, 3000);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = undefined;
    }
    const server = this.server;
    this.server = undefined;
    this.found.clear();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    return this.status();
  }
}
