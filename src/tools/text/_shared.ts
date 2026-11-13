/** Pieces reused by several text tools. */
import { formatBytes, looksLikeText, utf8Decode } from '../../lib/bytes';
import { hexDump, sniffType } from '../../lib/text';
import type { TextResult, Values } from '../types';

export const MODE = {
  key: 'mode',
  label: 'Mode',
  type: 'segmented',
  choices: [
    { value: 'encode', label: 'Encode' },
    { value: 'decode', label: 'Decode' },
  ],
  default: 'encode',
} as const;

export const isEncode = (values: Values): boolean => values.mode === 'encode';
export const isDecode = (values: Values): boolean => values.mode === 'decode';

export const swapMode = (values: { mode: string }): { mode: string } => ({
  mode: values.mode === 'encode' ? 'decode' : 'encode',
});

export const INDENT = {
  key: 'indent',
  label: 'Indent',
  type: 'select',
  choices: [
    { value: '2', label: '2 spaces' },
    { value: '4', label: '4 spaces' },
    { value: 'tab', label: 'Tabs' },
  ],
  default: '2',
} as const;

/**
 * Presents decoded bytes: as text when they are text, otherwise as a hex dump
 * with the raw bytes attached so they can be saved (and previewed if an image).
 */
export function decodedResult(bytes: Uint8Array, mimeHint = ''): TextResult {
  const sniffed = sniffType(bytes);
  const mime = mimeHint || sniffed?.mime || 'application/octet-stream';
  const isImage = mime.startsWith('image/');
  if (!isImage && looksLikeText(bytes)) {
    return { output: utf8Decode(bytes), info: `Decoded ${formatBytes(bytes.length)} of text` };
  }
  const ext = sniffed?.ext ?? (mime === 'image/svg+xml' ? 'svg' : 'bin');
  return {
    output: hexDump(bytes),
    info: `Decoded ${formatBytes(bytes.length)} of binary data (${mime})`,
    binary: { name: `decoded.${ext}`, mime, bytes },
    preview: isImage ? { kind: 'image', bytes, mime } : undefined,
  };
}
