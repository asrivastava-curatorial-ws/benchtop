/** Lazy loaders for the vendored CyberChef operations, imported by the recipe worker only. */
import { setPortLoader } from './cyberchef-port';

/*
 * What CyberChef's own worker provides and some of its code expects: a status
 * callback, Node's Buffer (the SM2 code), and globals that libraries assign to
 * without declaring them (md6's _hash, jsrsasign's X509CRL result), which
 * strict-mode modules only allow when the global already exists.
 */
const scope = globalThis as Record<string, unknown>;
scope.sendStatusMessage ??= () => undefined;
scope._hash ??= undefined;
scope.result ??= undefined;

async function ensureBuffer(): Promise<void> {
  if (!scope.Buffer) scope.Buffer = (await import('buffer')).Buffer;
}

const modules = import.meta.glob('../vendor/cyberchef/operations/*.mjs');

setPortLoader((file) => {
  const load = modules[`../vendor/cyberchef/operations/${file}.mjs`];
  return load ? (ensureBuffer().then(load) as never) : undefined;
});
