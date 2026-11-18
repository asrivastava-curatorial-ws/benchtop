/**
 * CyberChef operations that show their result: Render PDF (the pages, drawn
 * with PDF.js), Show on map (an offline map) and Optical Character
 * Recognition (the app's Tesseract engine, through the main thread).
 */
import { fromBase64 } from '../../lib/bytes';
import { WORLD_LAND } from '../../lib/net/world';
import { bArg, bool, bytesToLatin1, defineOp, nArg, num, OpError, type Operation, type OpResult, sArg, sel } from '../core';
import { callHost } from '../host';
import { esc } from './charts';

/* ----------------------------------------------------------- Render PDF --- */

function renderPdf(input: Uint8Array, format: string): OpResult | Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes = format === 'Base64' ? fromBase64(bytesToLatin1(input).replace(/\s+/g, '')) : input;
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) throw new OpError('Input does not appear to be a PDF file.');
  return { value: bytes, preview: { kind: 'pdf', bytes } };
}

/* ---------------------------------------------------------- Show on map --- */

const FORMATS = [
  'Degrees Minutes Seconds',
  'Degrees Decimal Minutes',
  'Decimal Degrees',
  'Geohash',
  'Military Grid Reference System',
  'Ordnance Survey National Grid',
  'Universal Transverse Mercator',
];
const DELIMITERS = ['Auto', 'Direction Preceding', 'Direction Following', '\\n', 'Comma', 'Semi-colon', 'Colon'];

type Convert = (input: string, inFormat: string, inDelim: string, outFormat: string, outDelim: string, includeDir: string, precision: number) => string;
// CyberChef's own coordinate parser (format and delimiter detection, MGRS, OS grid, UTM, geohash).
const coordinates = import.meta.glob<{ convertCoordinates: Convert }>('../vendor/cyberchef/lib/ConvertCoordinates.mjs');

const steps = [90, 45, 30, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1];

/** An equirectangular map around the point, from the bundled Natural Earth land outline. */
export function mapSvg(lat: number, lon: number, zoom: number): string {
  const level = Math.max(0, Math.min(3, Math.round(zoom)));
  const width = 360 / 2 ** level;
  const height = Math.min(180, width / 2);
  const cx = lon + 180;
  const cy = 90 - lat;
  const x0 = cx - width / 2;
  const y0 = Math.max(0, Math.min(180 - height, cy - height / 2));
  const grid = steps.find((s) => width / s >= 4) ?? 0.1;
  const lines: string[] = [];
  for (let g = Math.ceil((x0 - 180) / grid) * grid; g <= x0 - 180 + width; g += grid) lines.push(`M${(g + 180).toFixed(4)} ${y0}V${y0 + height}`);
  for (let g = Math.ceil((90 - y0 - height) / grid) * grid; g <= 90 - y0; g += grid) lines.push(`M${x0} ${(90 - g).toFixed(4)}H${x0 + width}`);
  const unit = width / 100;
  const label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const font = `font-family="JetBrains Mono, Menlo, Consolas, monospace" font-size="${(unit * 2.6).toFixed(4)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${Math.round((720 * height) / width)}" viewBox="${x0} ${y0} ${width} ${height}">` +
    `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="#0b1d2e"/>` +
    `<path d="${lines.join('')}" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>` +
    [-360, 0, 360].map((dx) => `<path transform="translate(${dx} 0)" d="${WORLD_LAND}" fill="#22402f" stroke="#3f7a57" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('') +
    `<g transform="translate(${cx} ${cy})">` +
    `<path d="M${-unit * 3} 0H${-unit}M${unit} 0H${unit * 3}M0 ${-unit * 3}V${-unit}M0 ${unit}V${unit * 3}" stroke="#f85149" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
    `<circle r="${unit * 0.8}" fill="#f85149" stroke="#ffffff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>` +
    `<rect x="${x0 + unit}" y="${y0 + height - unit * 5.5}" width="${unit * (label.length * 1.6 + 2)}" height="${unit * 4.5}" rx="${unit * 0.6}" fill="#0d1117" fill-opacity="0.85"/>` +
    `<text x="${x0 + unit * 2}" y="${y0 + height - unit * 2.3}" fill="#e6edf3" ${font}>${esc(label)}</text>` +
    `<text x="${x0 + width - unit}" y="${y0 + unit * 3}" fill="#8b949e" text-anchor="end" ${font}>Land outline: Natural Earth</text></svg>`
  );
}

async function showOnMap(input: string, zoom: number, inFormat: string, inDelim: string): Promise<OpResult | string> {
  if (input.replace(/\s+/g, '') === '') return input;
  const load = Object.values(coordinates)[0];
  if (!load) throw new OpError('The coordinate parser is missing from this build.');
  const { convertCoordinates } = await load();
  let latLong: string;
  try {
    latLong = convertCoordinates(input, inFormat, inDelim, 'Decimal Degrees', 'Comma', 'None', 5);
  } catch (error) {
    throw new OpError(error instanceof Error ? error.message : String(error));
  }
  latLong = latLong.replace(/[,]$/, '').replace(/°/g, '');
  const parts = latLong.split(',').map((v) => v.trim());
  if (parts.length !== 2 || parts.some((v) => v === '' || Number.isNaN(Number(v)))) {
    throw new OpError(`Could not show coordinates '${latLong}' on the map. Expected a latitude and longitude pair - check that the input format and delimiter are correct.`);
  }
  const svg = mapSvg(Number(parts[0]), Number(parts[1]), zoom);
  return { value: latLong, preview: { kind: 'svg', svg } };
}

/* ---------------------------------------------------------------- OCR --- */

const OEM_MODES = ['Tesseract only', 'LSTM only', 'Tesseract/LSTM Combined'];
const LANGUAGES: Record<string, string> = { English: 'eng', Hindi: 'hin', 'English and Hindi': 'eng+hin' };

async function recognise(input: Uint8Array, showConfidence: boolean, language: string): Promise<string> {
  if (input.length === 0) throw new OpError('Unsupported file type (supported: jpg,png,pbm,bmp) or no file provided');
  const result = await callHost('ocr', { image: input, language: LANGUAGES[language] ?? 'eng' }).catch((error: unknown) => {
    throw new OpError(`Error performing OCR on image. (${error instanceof Error ? error.message : String(error)})`);
  });
  return showConfidence ? `Confidence: ${result.confidence}%\n\n${result.text}` : result.text;
}

export const viewerOps: Operation[] = [
  defineOp({
    name: 'Render PDF',
    category: 'Multimedia',
    description: 'Shows the pages of a PDF (raw or Base64-encoded) and passes the PDF on, so it can be saved or used by later steps.',
    input: 'bytes',
    output: 'bytes',
    keywords: ['pdf', 'viewer', 'document'],
    magic: [{ pattern: /^%PDF-/, args: { format: 'Raw' } }],
    args: [sel('format', 'Input format', ['Base64', 'Raw'])],
    run: (input, a) => renderPdf(input, sArg(a, 'format')),
  }),
  defineOp({
    name: 'Show on map',
    category: 'Utils',
    description:
      'Shows a position on an offline map and outputs it as decimal degrees. Accepts the same notations as Convert co-ordinate format (degrees, minutes and seconds, geohash, MGRS, UTM, OS grid). The map is drawn from a coarse world outline, so it shows the region, not streets.',
    input: 'text',
    output: 'text',
    keywords: ['latitude', 'longitude', 'gps', 'location', 'geohash'],
    args: [
      num('zoom', 'Zoom Level', 13, { min: 0, max: 20, help: 'CyberChef’s web map zoom; the offline map shows at most zoom 3, a view 45° wide, as its world outline is too coarse for closer views.' }),
      sel('format', 'Input Format', ['Auto', ...FORMATS]),
      sel('delimiter', 'Input Delimiter', DELIMITERS),
    ],
    run: (input, a) => showOnMap(input, nArg(a, 'zoom'), sArg(a, 'format'), sArg(a, 'delimiter')),
  }),
  defineOp({
    name: 'Optical Character Recognition',
    category: 'Multimedia',
    description: 'Reads the text in a picture with the app’s offline Tesseract engine, in English, Hindi or both.',
    input: 'bytes',
    output: 'text',
    keywords: ['ocr', 'tesseract', 'scan', 'image to text'],
    args: [
      bool('confidence', 'Show confidence', true),
      sel('oem', 'OCR Engine Mode', OEM_MODES, 'LSTM only', { help: 'Benchtop includes only the LSTM engine (CyberChef’s default), which every mode uses.' }),
      sel('language', 'Language', Object.keys(LANGUAGES)),
    ],
    run: (input, a) => recognise(input, bArg(a, 'confidence'), sArg(a, 'language')),
  }),
];
