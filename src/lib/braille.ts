/**
 * Braille: English uncontracted (Unified English Braille, grade 1) and
 * Bharati Braille for Hindi and other Devanagari text, as Unicode braille,
 * Braille ASCII (for .brf files and embossers) and dot positions for signs.
 */

/** Unicode braille cell from dot numbers, e.g. "134" → ⠍. */
export const cell = (dots: string): string => String.fromCharCode(0x2800 + [...dots].reduce((m, d) => m | (1 << (Number(d) - 1)), 0));

const LETTERS = 'a:1 b:12 c:14 d:145 e:15 f:124 g:1245 h:125 i:24 j:245 k:13 l:123 m:134 n:1345 o:135 p:1234 q:12345 r:1235 s:234 t:2345 u:136 v:1236 w:2456 x:1346 y:13456 z:1356';
const LETTER = new Map(LETTERS.split(' ').map((p) => [p[0] as string, cell(p.slice(2))]));
const DIGIT_LETTER = 'jabcdefghi';

const PUNCTUATION: Record<string, string> = {
  ',': cell('2'),
  ';': cell('23'),
  ':': cell('25'),
  '.': cell('256'),
  '!': cell('235'),
  '?': cell('236'),
  "'": cell('3'),
  '’': cell('3'),
  '-': cell('36'),
  '“': cell('236'),
  '”': cell('356'),
  '(': cell('5') + cell('126'),
  ')': cell('5') + cell('345'),
  '/': cell('456') + cell('34'),
  '@': cell('4') + cell('1'),
  '&': cell('4') + cell('12346'),
  '%': cell('46') + cell('356'),
  '+': cell('5') + cell('235'),
  '=': cell('5') + cell('2356'),
  '*': cell('5') + cell('35'),
  '#': cell('456') + cell('1456'),
  $: cell('4') + cell('234'),
  '₹': cell('4') + cell('1235'),
};

const NUMBER_SIGN = cell('3456');
const CAPITAL = cell('6');
const GRADE1 = cell('56');

/** English, uncontracted UEB. */
export function englishBraille(text: string): string {
  let out = '';
  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (/^\s+$/.test(word)) {
      out += word.replace(/[^\n]/g, ' ').replace(/ +/g, ' ');
      continue;
    }
    const letters = word.replace(/[^A-Za-z]/g, '');
    // A whole word in capitals takes the capitals-word indicator.
    const allCaps = letters.length > 1 && letters === letters.toUpperCase();
    if (allCaps) out += CAPITAL + CAPITAL;
    let inNumber = false;
    let quote = 0;
    for (const ch of word) {
      if (/\d/.test(ch)) {
        if (!inNumber) out += NUMBER_SIGN;
        out += LETTER.get(DIGIT_LETTER[Number(ch)] as string);
        inNumber = true;
        continue;
      }
      if (inNumber && (ch === '.' || ch === ',')) {
        out += PUNCTUATION[ch];
        continue;
      }
      const lower = ch.toLowerCase();
      if (LETTER.has(lower)) {
        // a–j straight after a number would read as digits.
        if (inNumber && 'abcdefghij'.includes(lower)) out += GRADE1;
        if (ch !== lower && !allCaps) out += CAPITAL;
        out += LETTER.get(lower);
      } else if (ch === '"') {
        out += quote++ % 2 === 0 ? cell('236') : cell('356');
      } else out += PUNCTUATION[ch] ?? ch;
      inNumber = false;
    }
  }
  return out;
}

/* ----------------------------------------------------------- Bharati -- */

const DEVANAGARI: Record<string, string> = {
  अ: '1',
  आ: '345',
  इ: '24',
  ई: '35',
  उ: '136',
  ऊ: '1256',
  ए: '15',
  ऐ: '34',
  ओ: '135',
  औ: '246',
  क: '13',
  ख: '46',
  ग: '1245',
  घ: '126',
  ङ: '346',
  च: '14',
  छ: '16',
  ज: '245',
  झ: '356',
  ञ: '25',
  ट: '23456',
  ठ: '2456',
  ड: '1246',
  ढ: '123456',
  ण: '3456',
  त: '2345',
  थ: '1456',
  द: '145',
  ध: '2346',
  न: '1345',
  प: '1234',
  फ: '235',
  ब: '12',
  भ: '45',
  म: '134',
  य: '13456',
  र: '1235',
  ल: '123',
  व: '1236',
  श: '146',
  ष: '12346',
  स: '234',
  ह: '125',
  '्': '4',
  'ं': '56',
  'ः': '6',
  'ँ': '3',
  ऽ: '2',
  '।': '256',
};

/** Vowel signs are written as the full vowel after the consonant. */
const MATRAS: Record<string, string> = { 'ा': '345', 'ि': '24', 'ी': '35', 'ु': '136', 'ू': '1256', 'े': '15', 'ै': '34', 'ो': '135', 'ौ': '246' };

const CONSONANT = /[क-ह]/;
const isIndependentVowel = (c: string | undefined) => !!c && /[अ-औ]/.test(c);

/** Hindi (and other Devanagari text) in Bharati Braille. Latin letters and digits use the English rules. */
export function bharatiBraille(text: string): string {
  const chars = [...text.normalize('NFD')];
  let out = '';
  let inNumber = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const next = chars[i + 1];
    // Devanagari digits ० to ९ and ASCII digits share the number sign.
    const digit = /[०-९]/.test(ch) ? ch.charCodeAt(0) - 0x0966 : /\d/.test(ch) ? Number(ch) : -1;
    if (digit >= 0) {
      if (!inNumber) out += NUMBER_SIGN;
      out += LETTER.get(DIGIT_LETTER[digit] as string);
      inNumber = true;
      continue;
    }
    inNumber = false;
    if (ch === 'ऋ' || ch === 'ृ') {
      out += cell('5') + cell('1235');
      continue;
    }
    if (CONSONANT.test(ch)) {
      // A nukta (ड़, ज़…) comes first in braille.
      if (next === '़') out += cell('5');
      out += cell(DEVANAGARI[ch] ?? '');
      // Special conjuncts with their own cells.
      if (next === '्' && ch === 'क' && chars[i + 2] === 'ष') {
        out = out.slice(0, -1) + cell('12345');
        i += 2;
        continue;
      }
      if (next === '्' && ch === 'ज' && chars[i + 2] === 'ञ') {
        out = out.slice(0, -1) + cell('156');
        i += 2;
        continue;
      }
      const after = next === '़' ? chars[i + 2] : next;
      // The inherent a is written only before an independent vowel letter.
      if (isIndependentVowel(after)) out += cell('1');
      continue;
    }
    if (ch === '़') continue;
    if (MATRAS[ch]) {
      out += cell(MATRAS[ch]);
      continue;
    }
    if (DEVANAGARI[ch]) {
      out += cell(DEVANAGARI[ch]);
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      out += englishBraille(ch);
      continue;
    }
    out += PUNCTUATION[ch] ?? (ch === '\u200D' || ch === '\u200C' ? '' : ch);
  }
  return out;
}

/** North American Braille ASCII, the plain-text form embossers and .brf files use. */
const ASCII = ' A1B\'K2L@CIF/MSP"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=';

export function toBrailleAscii(unicode: string): string {
  return [...unicode]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x2800 && code <= 0x283f) return ASCII[code - 0x2800];
      if (code > 0x283f && code <= 0x28ff) return ASCII[(code - 0x2800) & 0x3f];
      return ch;
    })
    .join('');
}

/** Dot numbers present in a cell, 1 to 6. */
export const dotsOf = (ch: string): number[] => {
  const v = (ch.codePointAt(0) ?? 0x2800) - 0x2800;
  return [1, 2, 3, 4, 5, 6].filter((d) => v & (1 << (d - 1)));
};

export interface SignSize {
  /** Dot diameter, dot spacing inside a cell, cell to cell, line to line; millimetres. */
  readonly dot: number;
  readonly dotGap: number;
  readonly cellGap: number;
  readonly lineGap: number;
}

/** Standard signage sizes (close to ADA and Marburg Medium). */
export const SIGN: SignSize = { dot: 1.5, dotGap: 2.5, cellGap: 6.2, lineGap: 10 };

/** An SVG in millimetres with one circle per raised dot, for signs, laser cutting or 3D printing. */
export function brailleSvg(unicode: string, size: SignSize = SIGN, maxCells = 32): string {
  const lines: string[] = [];
  for (const raw of unicode.split('\n')) {
    let line = '';
    for (const word of raw.split(' ')) {
      if (line && [...line].length + 1 + [...word].length > maxCells) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  const margin = 5;
  const width = margin * 2 + Math.max(1, ...lines.map((l) => [...l].length)) * size.cellGap;
  const height = margin * 2 + lines.length * size.lineGap;
  const circles: string[] = [];
  lines.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      for (const d of dotsOf(ch)) {
        const x = margin + col * size.cellGap + (d > 3 ? size.dotGap : 0) + size.dot / 2;
        const y = margin + row * size.lineGap + ((d - 1) % 3) * size.dotGap + size.dot / 2;
        circles.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(size.dot / 2).toFixed(2)}"/>`);
      }
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}mm" height="${height.toFixed(1)}mm" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">${circles.join('')}</g></svg>\n`;
}
