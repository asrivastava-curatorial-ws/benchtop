/**
 * Password-based AES encryption using the platform's Web Crypto implementation.
 *
 * Two containers are supported:
 *
 * - `gcm`: AES-256-GCM (authenticated).  Layout, all Base64-encoded:
 *     "BTA1" | iterations (uint32, big endian) | salt (16) | IV (12) | ciphertext + tag (16)
 *   The key is PBKDF2-HMAC-SHA256(password, salt, iterations).
 *
 * - `openssl`: AES-256-CBC in the format written by
 *     openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter N -salt -a
 *   i.e. "Salted__" | salt (8) | ciphertext, where key and IV are the first
 *   32 and next 16 bytes of PBKDF2-HMAC-SHA256(password, salt, N).
 */
import { concatBytes, fromBase64, randomBytes, toBase64, utf8Encode, wrapLines } from './bytes';
import { ToolError } from './errors';

export type AesFormat = 'gcm' | 'openssl';

const MAGIC = utf8Encode('BTA1');
const SALTED = utf8Encode('Salted__');
const WRONG = 'Decryption failed: the password is wrong or the data has been altered.';

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new ToolError('Web Crypto is not available in this environment.');
  return api;
}

async function derive(password: string, salt: Uint8Array, iterations: number, bits: number): Promise<Uint8Array> {
  const material = await subtle().importKey('raw', utf8Encode(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const derived = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, bits);
  return new Uint8Array(derived);
}

const importAes = (raw: Uint8Array, name: 'AES-GCM' | 'AES-CBC', usage: KeyUsage): Promise<CryptoKey> => subtle().importKey('raw', raw as BufferSource, name, false, [usage]);

function checkInputs(password: string, iterations: number): void {
  if (password === '') throw new ToolError('Enter a password.');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) {
    throw new ToolError('Iterations must be a whole number between 1 and 10,000,000.');
  }
}

export async function aesEncrypt(data: Uint8Array, password: string, format: AesFormat, iterations: number): Promise<string> {
  checkInputs(password, iterations);
  if (format === 'gcm') {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await importAes(await derive(password, salt, iterations, 256), 'AES-GCM', 'encrypt');
    const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, iterations);
    return toBase64(concatBytes(MAGIC, header, salt, iv, sealed));
  }
  const salt = randomBytes(8);
  const derived = await derive(password, salt, iterations, 384);
  const key = await importAes(derived.subarray(0, 32), 'AES-CBC', 'encrypt');
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: derived.subarray(32, 48) as BufferSource }, key, data as BufferSource));
  return wrapLines(toBase64(concatBytes(SALTED, salt, sealed)), 64);
}

export async function aesDecrypt(text: string, password: string, format: AesFormat, iterations: number): Promise<Uint8Array> {
  checkInputs(password, format === 'gcm' ? 1 : iterations);
  let blob: Uint8Array;
  try {
    blob = fromBase64(text);
  } catch (error) {
    throw new ToolError(`The encrypted text is not valid Base64. ${error instanceof Error ? error.message : ''}`.trim());
  }
  const startsWith = (prefix: Uint8Array) => blob.length >= prefix.length && prefix.every((byte, index) => blob[index] === byte);

  if (format === 'gcm') {
    if (startsWith(SALTED)) throw new ToolError('This looks like OpenSSL output. Switch the format to "OpenSSL compatible".');
    if (!startsWith(MAGIC) || blob.length < 4 + 4 + 16 + 12 + 16) {
      throw new ToolError('This is not data encrypted with the AES-256-GCM format of this tool.');
    }
    const stored = new DataView(blob.buffer, blob.byteOffset + 4, 4).getUint32(0);
    if (stored < 1 || stored > 10_000_000) throw new ToolError('The encrypted data has a corrupt header.');
    const salt = blob.subarray(8, 24);
    const iv = blob.subarray(24, 36);
    const key = await importAes(await derive(password, salt, stored, 256), 'AES-GCM', 'decrypt');
    try {
      return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, blob.subarray(36) as BufferSource));
    } catch {
      throw new ToolError(WRONG);
    }
  }

  if (startsWith(MAGIC)) throw new ToolError('This was encrypted with the AES-256-GCM format. Switch the format to match.');
  if (!startsWith(SALTED) || blob.length < 16 + 16 || (blob.length - 16) % 16 !== 0) {
    throw new ToolError('This is not OpenSSL "Salted__" output (expected: openssl enc -aes-256-cbc -pbkdf2 -salt -a).');
  }
  const derived = await derive(password, blob.subarray(8, 16), iterations, 384);
  const key = await importAes(derived.subarray(0, 32), 'AES-CBC', 'decrypt');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: derived.subarray(32, 48) as BufferSource }, key, blob.subarray(16) as BufferSource));
  } catch {
    throw new ToolError(`${WRONG} (For OpenSSL data the iteration count must also match.)`);
  }
}
