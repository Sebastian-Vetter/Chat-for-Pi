import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PeerIdentity {
  id: string;
  name: string;
  publicKey: string;
}
export function validPeer(peer: PeerIdentity) {
  if (
    !peer ||
    typeof peer.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(peer.id) ||
    typeof peer.name !== 'string' ||
    !peer.name.trim() ||
    peer.name.length > 60 ||
    /[\x00-\x1f\x7f\u2028-\u202e\u2066-\u2069]/.test(peer.name) ||
    typeof peer.publicKey !== 'string' ||
    peer.publicKey.length > 200
  )
    throw new Error('Invalid participant identity');
  if (createPublicKey(peer.publicKey).asymmetricKeyType !== 'ed25519')
    throw new Error('Invalid participant key');
}
export function proof(publicKey: string, message: string, signature: string) {
  try {
    return (
      typeof signature === 'string' &&
      signature.length < 200 &&
      verify(
        null,
        Buffer.from(message),
        createPublicKey(publicKey),
        Buffer.from(signature, 'base64url'),
      )
    );
  } catch {
    return false;
  }
}
export class InstallationIdentity {
  private file: string;
  private value: PeerIdentity & { privateKey: string };
  constructor(directory: string) {
    this.file = join(directory, 'identity.json');
    if (existsSync(this.file)) {
      this.value = JSON.parse(readFileSync(this.file, 'utf8'));
      // Never regenerate a damaged identity silently: it determines ownership.
      createPrivateKey(this.value.privateKey);
      validPeer({ ...this.value, name: this.value.name || 'Unnamed' });
      if (!proof(this.value.publicKey, 'identity-check', this.sign('identity-check')))
        throw new Error('Installation identity key mismatch');
    } else {
      const keys = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      this.value = {
        id: randomUUID(),
        name: '',
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      };
      this.save();
    }
  }
  public(): PeerIdentity {
    const { id, name, publicKey } = this.value;
    return { id, name, publicKey };
  }
  rename(name: string) {
    const next = { ...this.public(), name: typeof name === 'string' ? name.trim() : name };
    validPeer(next);
    this.value.name = next.name;
    this.save();
    return this.public();
  }
  sign(message: string) {
    return sign(null, Buffer.from(message), this.value.privateKey).toString('base64url');
  }
  private save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.value), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
