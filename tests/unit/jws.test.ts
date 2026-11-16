import { constants, createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { utf8Encode } from '../../src/lib/bytes';
import { type Algorithm, generateKey, type Jwk, jwkToPem, parseToken, pemToJwk, readKey, signBytes, signToken, thumbprint, verifyBytes } from '../../src/lib/jws';
import jwtDecoder from '../../src/tools/text/jwt-decoder';
import jwtEncoder from '../../src/tools/text/jwt-encoder';
import { field, run } from './helpers';

const NODE_HASH: Record<string, string> = { '256': 'sha256', '384': 'sha384', '512': 'sha512' };

/** Node's own crypto, to check our signatures against an independent implementation. */
function nodeVerifies(algorithm: Algorithm, jwk: Jwk, data: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({ key: { ...jwk, d: undefined, p: undefined, q: undefined, dp: undefined, dq: undefined, qi: undefined } as never, format: 'jwk' });
  if (algorithm === 'EdDSA' || algorithm === 'Ed25519') return nodeVerify(null, data, key, signature);
  const hash = algorithm === 'ES256K' ? 'sha256' : (NODE_HASH[algorithm.slice(2, 5)] as string);
  if (algorithm.startsWith('ES')) return nodeVerify(hash, data, { key, dsaEncoding: 'ieee-p1363' }, signature);
  if (algorithm.startsWith('PS')) return nodeVerify(hash, data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(algorithm.slice(2)) / 8 }, signature);
  return nodeVerify(hash, data, key, signature);
}

describe('JWS algorithms', () => {
  const data = utf8Encode('eyJhbGciOiJ4In0.eyJzdWIiOiIxIn0');
  for (const algorithm of ['RS256', 'RS512', 'PS256', 'PS384', 'ES256', 'ES384', 'ES512', 'ES256K', 'EdDSA', 'Ed25519'] as const) {
    it(`${algorithm} signs in a way Node's crypto accepts, and verifies its own signatures`, async () => {
      const pair = await generateKey(algorithm);
      if (pair instanceof Uint8Array) throw new Error('expected a key pair');
      const signature = await signBytes(algorithm, pair.privateJwk, data);
      expect(nodeVerifies(algorithm, pair.publicJwk, data, signature)).toBe(true);
      expect(await verifyBytes(algorithm, pair.publicJwk, data, signature)).toBe(true);
      const tampered = signature.slice();
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
      expect(await verifyBytes(algorithm, pair.publicJwk, data, tampered)).toBe(false);
    });
  }

  it('verifies signatures made by Node (P-256, Ed448, RSA-PSS)', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ecSig = nodeSign('sha256', data, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
    expect(await verifyBytes('ES256', pemToJwk(ec.publicKey.export({ type: 'spki', format: 'pem' }) as string), data, ecSig)).toBe(true);

    const ed = generateKeyPairSync('ed448');
    const edSig = nodeSign(null, data, ed.privateKey);
    expect(await verifyBytes('EdDSA', pemToJwk(ed.publicKey.export({ type: 'spki', format: 'pem' }) as string), data, edSig)).toBe(true);

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const psSig = nodeSign('sha384', data, { key: rsa.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 48 });
    expect(await verifyBytes('PS384', pemToJwk(rsa.publicKey.export({ type: 'pkcs1', format: 'pem' }) as string), data, psSig)).toBe(true);
  });

  it('reads private keys in every PEM flavour and writes PEM Node can load', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pkcs1 = pemToJwk(rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string);
    const pkcs8 = pemToJwk(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    expect(pkcs1).toEqual(pkcs8);
    expect(createPrivateKey(jwkToPem(pkcs1, 'private')).export({ format: 'jwk' }).n).toBe(pkcs1.n);

    const ec = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const sec1 = pemToJwk(ec.privateKey.export({ type: 'sec1', format: 'pem' }) as string);
    expect(sec1.crv).toBe('secp256k1');
    expect(sec1.x).toBe(ec.publicKey.export({ format: 'jwk' }).x);
    expect(createPrivateKey(jwkToPem(sec1, 'private')).export({ format: 'jwk' }).d).toBe(sec1.d);
    expect(createPublicKey(jwkToPem(sec1, 'public')).export({ format: 'jwk' }).y).toBe(sec1.y);

    const ed = generateKeyPairSync('ed25519');
    const edJwk = pemToJwk(ed.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    expect(edJwk.x).toBe(ed.publicKey.export({ format: 'jwk' }).x);
    expect(createPrivateKey(jwkToPem(edJwk, 'private')).export({ format: 'jwk' }).d).toBe(edJwk.d);
  });

  it('picks keys from a JWK set by kid', () => {
    const set = JSON.stringify({
      keys: [
        { kty: 'oct', k: 'AA', kid: 'a' },
        { kty: 'oct', k: 'AQ', kid: 'b' },
      ],
    });
    expect(readKey(set, { kid: 'b' }).k).toBe('AQ');
    expect(() => readKey(set, { kid: 'c' })).toThrow(/no key with kid "c"/);
  });

  it('computes RFC 7638 thumbprints', () => {
    // The example key from RFC 7638 section 3.1.
    const jwk: Jwk = {
      kty: 'RSA',
      n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
      e: 'AQAB',
    };
    expect(thumbprint(jwk)).toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
  });
});

describe('JWT tools', () => {
  it('signs with a generated ES256 key and the decoder verifies it with the public JWK', async () => {
    const pair = await generateKey('ES256');
    if (pair instanceof Uint8Array) throw new Error('expected a key pair');
    const token = await signToken({ alg: 'ES256', typ: 'JWT', kid: 'k1' }, { sub: 'ada', exp: 4102444800 }, 'ES256', pair.privateJwk);
    const result = await run(jwtDecoder, token, { secret: JSON.stringify({ keys: [{ ...pair.publicJwk, kid: 'k1' }] }) });
    expect(field(result, 'Signature')).toBe('Valid for this key');
    expect(field(result, 'Algorithm')).toMatch(/^ES256: ECDSA on P-256/);
    expect(result.preview?.kind === 'html' && result.preview.html).toContain('Expiration time');
  });

  it('keeps verifying HS256 tokens with a text secret', async () => {
    const sample =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjo0MTAyNDQ0ODAwfQ.ManHBJWIWxsOdEbNkWi4ch6pBEvoA1k3N1YcQokhnW4';
    expect(field(await run(jwtDecoder, sample, { secret: 'benchtop' }), 'Signature')).toBe('Valid for this secret');
    const wrong = await run(jwtDecoder, sample, { secret: 'nope' });
    expect(field(wrong, 'Signature')).toBe('INVALID for this secret');
    expect(wrong.warnings?.join(' ')).toMatch(/at least 32 bytes/);
  });

  it('warns about algorithm confusion when an HS token is checked with a PEM key', async () => {
    const token = await signToken({ alg: 'HS256' }, { sub: 'x' }, 'HS256', utf8Encode('-----BEGIN PUBLIC KEY-----'));
    const result = await run(jwtDecoder, token, { secret: '-----BEGIN PUBLIC KEY-----' });
    expect(result.warnings?.join(' ')).toMatch(/algorithm-confusion/);
  });

  it('generates a key pair in the encoder and shows it', async () => {
    const result = await run(jwtEncoder, '{"sub":"1"}', { algorithm: 'EdDSA', keySource: 'generate', kid: 'auto' });
    const token = parseToken(result.output ?? '');
    expect(token.header).toMatchObject({ alg: 'EdDSA', typ: 'JWT' });
    expect(typeof token.header.kid).toBe('string');
    expect(result.preview?.kind === 'html' && result.preview.html).toContain('BEGIN PUBLIC KEY');
  });

  it('signs RS256 with a PEM private key', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const result = await run(jwtEncoder, '{"sub":"1"}', { algorithm: 'RS256', secret: rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string });
    const token = parseToken(result.output ?? '');
    expect(nodeVerify('sha256', utf8Encode(token.signingInput), rsa.publicKey, token.signature)).toBe(true);
  });
});
