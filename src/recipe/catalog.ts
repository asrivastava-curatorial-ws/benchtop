/** Every operation the Recipe tool offers, looked up by id or by its CyberChef name. */
import { CATEGORY_ORDER, type Category, type Operation, slug } from './core';
import type { Catalog } from './magic';
import { arithmeticOps } from './ops/arithmetic';
import { avroOps } from './ops/avro';
import { chartOps } from './ops/charts';
import { codeOps } from './ops/code';
import { compressionOps } from './ops/compression';
import { cyberchefPortOps } from './ops/cyberchef-port';
import { dataFormatOps } from './ops/data-format';
import { datetimeOps } from './ops/datetime';
import { encryptionOps } from './ops/encryption';
import { extractorOps } from './ops/extractors';
import { hashingOps } from './ops/hashing';
import { multimediaOps } from './ops/multimedia';
import { networkingOps } from './ops/networking';
import { onlineOps } from './ops/online';
import { otherOps } from './ops/other';
import { pgpOps } from './ops/pgp';
import { protobufOps } from './ops/protobuf';
import { publicKeyOps } from './ops/public-key';
import { templateOps } from './ops/template';
import { languageOps, utilsOps } from './ops/utils';
import { viewerOps } from './ops/viewers';

export const OPERATIONS: readonly Operation[] = [
  ...dataFormatOps,
  ...avroOps,
  ...encryptionOps,
  ...publicKeyOps,
  ...pgpOps,
  ...arithmeticOps,
  ...networkingOps,
  ...protobufOps,
  ...onlineOps,
  ...languageOps,
  ...utilsOps,
  ...datetimeOps,
  ...extractorOps,
  ...templateOps,
  ...compressionOps,
  ...hashingOps,
  ...codeOps,
  ...multimediaOps,
  ...chartOps,
  ...viewerOps,
  ...otherOps,
  ...cyberchefPortOps,
];

const BY_ID = new Map(OPERATIONS.map((op) => [op.id, op]));

export const catalog: Catalog = { get: (id) => BY_ID.get(id), all: OPERATIONS };

/** Finds an operation by CyberChef name ("From Base64", "From_Base64") or id. */
export function findOperation(name: string): Operation | undefined {
  return BY_ID.get(name) ?? BY_ID.get(slug(name.replace(/_/g, ' ')));
}

export function categoriesOf(op: Operation): Category[] {
  return [op.category, ...(op.also ?? [])];
}

export function operationsIn(category: Category): Operation[] {
  return OPERATIONS.filter((op) => categoriesOf(op).includes(category));
}

export { CATEGORY_ORDER };
