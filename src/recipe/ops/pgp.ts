/**
 * CyberChef's PGP operations, built on OpenPGP.js (LGPL-3.0, loaded when a
 * PGP operation first runs).  CyberChef used Keybase's kbpgp for most of them;
 * the arguments and the text of the results are the same.
 */
import type { Key, PartialConfig, PrivateKey, VerifyMessageResult } from 'openpgp';
import { type Args, defineOp, OpError, type Operation, sArg, sel, str, txt, utf8 } from '../core';

const C = 'Public Key' as const;

type OpenPgp = typeof import('openpgp');
let library: Promise<OpenPgp> | null = null;
const pgp = (): Promise<OpenPgp> => (library ??= import('openpgp'));

/** CyberChef makes and accepts 1024-bit RSA keys, which OpenPGP.js refuses by default. */
const CONFIG: PartialConfig = { minRSABits: 1024 };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function importPrivateKey(armored: string, passphrase: string): Promise<PrivateKey> {
  const openpgp = await pgp();
  let key: PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: armored, config: CONFIG });
  } catch (error) {
    throw new OpError(`Could not import private key: ${message(error)}`);
  }
  if (key.isDecrypted()) return key;
  if (!passphrase) throw new OpError('Could not import private key: Did not provide passphrase with locked private key.');
  try {
    return await openpgp.decryptKey({ privateKey: key, passphrase, config: CONFIG });
  } catch (error) {
    throw new OpError(`Could not import private key: ${message(error)}`);
  }
}

export async function importPublicKey(armored: string): Promise<Key> {
  const openpgp = await pgp();
  try {
    return await openpgp.readKey({ armoredKey: armored, config: CONFIG });
  } catch (error) {
    throw new OpError(`Could not import public key: ${message(error)}`);
  }
}

/** The text CyberChef puts above a verified message: who signed it, with which key, and when. */
async function signerReport(signatures: VerifyMessageResult['signatures'], keys: readonly Key[]): Promise<string> {
  const signature = signatures[0];
  if (!signature) throw new OpError('The data does not appear to be signed.');
  await signature.verified;
  const key = keys.find((k) => k.getKeys(signature.keyID).length > 0);
  if (!key) throw new OpError('Could not identify a key manager.');
  let text = 'Signed by ';
  try {
    const openpgp = await pgp();
    const { user } = await key.getPrimaryUser(undefined, undefined, { ...openpgp.config, ...CONFIG });
    const { name, comment, email } = user.userID ?? {};
    if (name || comment || email) text += `${name ? `${name} ` : ''}${comment ? `(${comment}) ` : ''}${email ? `<${email}>` : ''}\n`;
  } catch {
    // A key without a valid user ID still identifies the signer by its fingerprint.
  }
  const fingerprint = key.getFingerprint();
  const created = (await signature.signature).packets[0]?.created ?? new Date(0);
  return `${text}PGP key ID: ${fingerprint.slice(-8).toUpperCase()}\nPGP fingerprint: ${fingerprint}\nSigned on ${created.toUTCString()}\n----------------------------------\n`;
}

const ALGORITHMS: Record<number, string> = {
  1: 'RSA (Encrypt or Sign)',
  2: 'RSA Encrypt-Only',
  3: 'RSA Sign-Only',
  16: 'ElGamal Encrypt-Only',
  17: 'DSA',
  18: 'ECDH',
  19: 'ECDSA',
  22: 'EdDSA',
  25: 'X25519',
  27: 'Ed25519',
};

/** Bit length of a big-endian integer, ignoring leading zero bytes. */
export function bitLength(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return 0;
  return 32 - Math.clz32(bytes[i] as number) + (bytes.length - i - 1) * 8;
}

async function generate(a: Args): Promise<string> {
  const openpgp = await pgp();
  const [kind = 'RSA', size = '2048'] = sArg(a, 'type').split('-');
  const bits = Number.parseInt(size, 10);
  const name = sArg(a, 'name');
  const email = sArg(a, 'email');
  const passphrase = sArg(a, 'password');
  const userIDs = name || email ? [{ name: name || undefined, email: email || undefined }] : [{}];
  const algorithm =
    kind.toLowerCase() === 'rsa'
      ? ({ type: 'rsa', rsaBits: bits } as const)
      : ({ type: 'ecc', curve: bits === 25519 ? 'curve25519Legacy' : bits === 384 ? 'nistP384' : bits === 521 ? 'nistP521' : 'nistP256' } as const);
  const year = 365 * 86400;
  try {
    // As CyberChef: a primary key for certifying, a signing subkey valid for 8 years and an encryption subkey for 2.
    const { privateKey, publicKey } = await openpgp.generateKey({
      ...algorithm,
      userIDs,
      passphrase: passphrase || undefined,
      subkeys: [
        { ...algorithm, sign: true, keyExpirationTime: 8 * year },
        { ...algorithm, keyExpirationTime: 2 * year },
      ],
      format: 'armored',
      config: CONFIG,
    });
    return `${privateKey}\n${publicKey.trim()}`;
  } catch (error) {
    throw new OpError(`Error whilst generating key pair: ${message(error)}`);
  }
}

async function encrypt(input: string, a: Args, sign: boolean): Promise<string> {
  const openpgp = await pgp();
  const publicArmored = sArg(a, 'public');
  if (sign && !sArg(a, 'private')) throw new OpError('Enter the private key of the signer.');
  if (!publicArmored) throw new OpError('Enter the public key of the recipient.');
  const signingKeys = sign ? await importPrivateKey(sArg(a, 'private'), sArg(a, 'passphrase')) : undefined;
  const encryptionKeys = await importPublicKey(publicArmored);
  try {
    const plain = await openpgp.createMessage({ binary: utf8(input) });
    return (await openpgp.encrypt({ message: plain, encryptionKeys, signingKeys, format: 'armored', config: CONFIG })) as string;
  } catch (error) {
    throw new OpError(sign ? `Couldn't sign message: ${message(error)}` : `Couldn't encrypt message with provided public key: ${message(error)}`);
  }
}

async function readArmoredMessage(input: string) {
  const openpgp = await pgp();
  return openpgp.readMessage({ armoredMessage: input, config: CONFIG });
}

async function decrypt(input: string, a: Args): Promise<Uint8Array> {
  const openpgp = await pgp();
  if (!sArg(a, 'private')) throw new OpError('Enter the private key of the recipient.');
  const decryptionKeys = await importPrivateKey(sArg(a, 'private'), sArg(a, 'passphrase'));
  try {
    const { data } = await openpgp.decrypt({ message: await readArmoredMessage(input), decryptionKeys, format: 'binary', config: CONFIG });
    return data as Uint8Array;
  } catch (error) {
    throw new OpError(`Couldn't decrypt message with provided private key: ${message(error)}`);
  }
}

async function sign(input: string, a: Args): Promise<string> {
  const openpgp = await pgp();
  if (!sArg(a, 'private')) throw new OpError('Enter the private key of the signer.');
  const signingKeys = await importPrivateKey(sArg(a, 'private'), sArg(a, 'passphrase'));
  try {
    return (await openpgp.sign({ message: await openpgp.createMessage({ binary: utf8(input) }), signingKeys, format: 'armored', config: CONFIG })) as string;
  } catch (error) {
    throw new OpError(`Couldn't sign message: ${message(error)}`);
  }
}

const joinReport = (report: string, data: Uint8Array): Uint8Array => {
  const head = utf8(report);
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  // CyberChef trims the combined text (ASCII white space only, so UTF-8 sequences stay whole).
  let end = out.length;
  while (end > 0 && [9, 10, 11, 12, 13, 32].includes(out[end - 1] as number)) end--;
  return out.subarray(0, end);
};

async function verify(input: string, a: Args): Promise<Uint8Array> {
  const openpgp = await pgp();
  if (!sArg(a, 'public')) throw new OpError('Enter the public key of the signer.');
  const key = await importPublicKey(sArg(a, 'public'));
  try {
    const { data, signatures } = await openpgp.verify({ message: await readArmoredMessage(input), verificationKeys: key, format: 'binary', config: CONFIG });
    return joinReport(await signerReport(signatures, [key]), data as Uint8Array);
  } catch (error) {
    throw new OpError(`Couldn't verify message: ${message(error)}`);
  }
}

async function decryptAndVerify(input: string, a: Args): Promise<Uint8Array> {
  const openpgp = await pgp();
  if (!sArg(a, 'public')) throw new OpError('Enter the public key of the signer.');
  if (!sArg(a, 'private')) throw new OpError('Enter the private key of the recipient.');
  const decryptionKeys = await importPrivateKey(sArg(a, 'private'), sArg(a, 'passphrase'));
  const key = await importPublicKey(sArg(a, 'public'));
  try {
    const { data, signatures } = await openpgp.decrypt({ message: await readArmoredMessage(input), decryptionKeys, verificationKeys: key, format: 'binary', config: CONFIG });
    return joinReport(await signerReport(signatures, [key]), data as Uint8Array);
  } catch (error) {
    throw new OpError(`Couldn't verify message: ${message(error)}`);
  }
}

async function parseKey(input: string): Promise<string> {
  if (!input.length) throw new OpError('No key provided');
  const openpgp = await pgp();
  let key: Key;
  try {
    key = await openpgp.readKey({ armoredKey: input, config: CONFIG });
  } catch (error) {
    throw new OpError(`Unable to parse key: ${error instanceof Error && error.message ? error.message : 'invalid key data'}`);
  }
  const packet = key.keyPacket as unknown as { version: number; algorithm: number; publicParams?: { n?: Uint8Array; oid?: { getName?: () => string } } };
  let out = 'Public Key Information\n======================\n';
  out += `Version       : ${packet.version}\n`;
  out += `Creation Date : ${key.getCreationTime().toISOString()}\n`;
  out += `Key ID        : ${key.getKeyID().toHex().toUpperCase()}\n`;
  out += `Fingerprint   : ${key.getFingerprint().toUpperCase()}\n`;
  out += `Algorithm     : ${ALGORITHMS[packet.algorithm] ?? `Unknown (${packet.algorithm})`}\n`;
  if (packet.publicParams?.n) out += `Key Size      : ${bitLength(packet.publicParams.n)} bits\n`;
  const curve = packet.publicParams?.oid?.getName ? packet.publicParams.oid.getName() : packet.algorithm === 25 ? 'Curve25519 (X25519)' : packet.algorithm === 27 ? 'Ed25519' : null;
  if (curve) out += `Curve         : ${curve}\n`;
  return out;
}

const PRIVATE = txt('private', 'Private key of signer', '');
const PASSPHRASE = str('passphrase', 'Private key passphrase', '');

export const pgpOps: Operation[] = [
  defineOp({
    name: 'Generate PGP Key Pair',
    category: C,
    description:
      'Makes a new PGP key pair (private key first, then the public key), with a signing subkey and an encryption subkey. RSA and elliptic-curve (NIST P-256/384/521 or Curve25519) keys are supported.',
    input: 'text',
    output: 'text',
    volatile: true,
    keywords: ['gpg', 'gnupg', 'openpgp', 'keygen'],
    args: [
      sel('type', 'Key type', ['RSA-1024', 'RSA-2048', 'RSA-4096', 'ECC-256', 'ECC-384', 'ECC-521', 'ECC-25519'], 'RSA-1024', {
        help: 'RSA-1024 is CyberChef’s default but is weak today; prefer RSA-4096 or ECC-25519 for real use.',
      }),
      str('password', 'Password (optional)'),
      str('name', 'Name (optional)'),
      str('email', 'Email (optional)'),
    ],
    run: (_input, a) => generate(a),
  }),
  defineOp({
    name: 'PGP Encrypt',
    category: C,
    description: 'Encrypts the input for the owner of an ASCII-armoured PGP public key.',
    input: 'text',
    output: 'text',
    volatile: true,
    keywords: ['gpg', 'gnupg', 'openpgp'],
    args: [txt('public', 'Public key of recipient')],
    run: (input, a) => encrypt(input, a, false),
  }),
  defineOp({
    name: 'PGP Decrypt',
    category: C,
    description: 'Decrypts an ASCII-armoured PGP message with the recipient’s private key (and its passphrase, if it has one).',
    input: 'text',
    output: 'bytes',
    keywords: ['gpg', 'gnupg', 'openpgp'],
    args: [txt('private', 'Private key of recipient'), str('passphrase', 'Private key passphrase')],
    run: decrypt,
  }),
  defineOp({
    name: 'PGP Sign',
    category: C,
    description: 'Signs the input with a PGP private key, giving an ASCII-armoured signed message.',
    input: 'text',
    output: 'text',
    volatile: true,
    keywords: ['gpg', 'gnupg', 'openpgp', 'signature'],
    args: [PRIVATE, str('passphrase', 'Private key passphrase (optional)')],
    run: sign,
  }),
  defineOp({
    name: 'PGP Verify',
    category: C,
    description: 'Checks the signature on a signed PGP message with the signer’s public key, then shows who signed it, when, and the message.',
    input: 'text',
    output: 'bytes',
    keywords: ['gpg', 'gnupg', 'openpgp', 'signature'],
    args: [txt('public', 'Public key of signer')],
    run: verify,
  }),
  defineOp({
    name: 'PGP Encrypt and Sign',
    category: C,
    description: 'Signs the input with the sender’s private key and encrypts it for the recipient’s public key.',
    input: 'text',
    output: 'text',
    volatile: true,
    keywords: ['gpg', 'gnupg', 'openpgp'],
    args: [PRIVATE, PASSPHRASE, txt('public', 'Public key of recipient')],
    run: (input, a) => encrypt(input, a, true),
  }),
  defineOp({
    name: 'PGP Decrypt and Verify',
    category: C,
    description: 'Decrypts a PGP message with the recipient’s private key and checks its signature with the signer’s public key.',
    input: 'text',
    output: 'bytes',
    keywords: ['gpg', 'gnupg', 'openpgp'],
    args: [txt('public', 'Public key of signer'), txt('private', 'Private key of recipient'), str('passphrase', 'Private key password')],
    run: decryptAndVerify,
  }),
  defineOp({
    name: 'Parse PGP Key',
    category: C,
    description: 'Shows the version, creation date, key ID, fingerprint, algorithm and size or curve of an ASCII-armoured PGP key.',
    input: 'text',
    output: 'text',
    keywords: ['gpg', 'gnupg', 'openpgp', 'fingerprint'],
    run: (input) => parseKey(input),
  }),
];
