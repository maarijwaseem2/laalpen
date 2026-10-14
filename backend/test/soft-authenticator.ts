import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/** A tiny software passkey (ES256, "none" attestation) so the real WebAuthn checks run in tests. */
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

export function softAuthenticator(origin = 'http://localhost:8081', rpId = 'localhost') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credId = randomBytes(16);
  let counter = 0;
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

  return {
    id: b64u(credId),
    create(options: { challenge: string }) {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), u32(counter), Buffer.alloc(16), len, credId, Buffer.from(cose)]);
      const att = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientData), attestationObject: b64u(att), transports: ['internal'] } };
    },
    get(options: { challenge: string }, opts: { origin?: string } = {}) {
      counter += 1;
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: opts.origin ?? origin, crossOrigin: false }));
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x05]), u32(counter)]);
      const signature = sign('sha256', Buffer.concat([authData, sha(clientData)]), privateKey);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) } };
    },
  };
}
