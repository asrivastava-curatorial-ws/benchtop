import { defineTextTool } from '../types';

/** Mathematical alphanumeric symbols: offsets of A, a and 0 for each style (Unicode block 1D400). */
const MATH: Record<string, [number, number, number | null]> = {
  Bold: [0x1d400, 0x1d41a, 0x1d7ce],
  Italic: [0x1d434, 0x1d44e, null],
  'Bold italic': [0x1d468, 0x1d482, null],
  Script: [0x1d49c, 0x1d4b6, null],
  'Bold script': [0x1d4d0, 0x1d4ea, null],
  Fraktur: [0x1d504, 0x1d51e, null],
  'Double-struck': [0x1d538, 0x1d552, 0x1d7d8],
  'Bold fraktur': [0x1d56c, 0x1d586, null],
  Sans: [0x1d5a0, 0x1d5ba, 0x1d7e2],
  'Sans bold': [0x1d5d4, 0x1d5ee, 0x1d7ec],
  'Sans italic': [0x1d608, 0x1d622, null],
  'Sans bold italic': [0x1d63c, 0x1d656, null],
  Monospace: [0x1d670, 0x1d68a, 0x1d7f6],
};

/** Letters missing from some styles live in the Letterlike Symbols block. */
const HOLES: Record<number, number> = {
  119893: 0x210e,
  119965: 0x212c,
  119968: 0x2130,
  119969: 0x2131,
  119971: 0x210b,
  119972: 0x2110,
  119975: 0x2112,
  119976: 0x2133,
  119981: 0x211b,
  119994: 0x212f,
  119996: 0x210a,
  120004: 0x2134,
  120070: 0x212d,
  120075: 0x210c,
  120076: 0x2111,
  120085: 0x211c,
  120093: 0x2128,
  120122: 0x2102,
  120127: 0x210d,
  120133: 0x2115,
  120135: 0x2119,
  120136: 0x211a,
  120137: 0x211d,
  120145: 0x2124,
};

const mapMath = (text: string, [upper, lower, digits]: [number, number, number | null]) =>
  [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      let point: number | null = null;
      if (code >= 65 && code <= 90) point = upper + code - 65;
      else if (code >= 97 && code <= 122) point = lower + code - 97;
      else if (digits !== null && code >= 48 && code <= 57) point = digits + code - 48;
      return point === null ? char : String.fromCodePoint(HOLES[point] ?? point);
    })
    .join('');

const SMALL_CAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';
const UPSIDE: Record<string, string> = {
  a: 'ɐ',
  b: 'q',
  c: 'ɔ',
  d: 'p',
  e: 'ǝ',
  f: 'ɟ',
  g: 'ƃ',
  h: 'ɥ',
  i: 'ᴉ',
  j: 'ɾ',
  k: 'ʞ',
  l: 'l',
  m: 'ɯ',
  n: 'u',
  o: 'o',
  p: 'd',
  q: 'b',
  r: 'ɹ',
  s: 's',
  t: 'ʇ',
  u: 'n',
  v: 'ʌ',
  w: 'ʍ',
  x: 'x',
  y: 'ʎ',
  z: 'z',
  A: '∀',
  C: 'Ɔ',
  E: 'Ǝ',
  F: 'Ⅎ',
  G: '⅁',
  J: 'ſ',
  L: '˥',
  M: 'W',
  P: 'Ԁ',
  T: '⊥',
  U: '∩',
  V: 'Λ',
  W: 'M',
  Y: '⅄',
  '1': 'Ɩ',
  '2': 'ᄅ',
  '3': 'Ɛ',
  '4': 'ㄣ',
  '5': 'ϛ',
  '6': '9',
  '7': 'ㄥ',
  '9': '6',
  '.': '˙',
  ',': "'",
  "'": ',',
  '"': '„',
  '?': '¿',
  '!': '¡',
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  _: '‾',
  '&': '⅋',
};

export const STYLES: Record<string, (text: string) => string> = {
  ...Object.fromEntries(Object.entries(MATH).map(([name, offsets]) => [name, (text: string) => mapMath(text, offsets)])),
  Circled: (text) =>
    [...text]
      .map((char) =>
        /[A-Z]/.test(char)
          ? String.fromCodePoint(0x24b6 + char.charCodeAt(0) - 65)
          : /[a-z]/.test(char)
            ? String.fromCodePoint(0x24d0 + char.charCodeAt(0) - 97)
            : /[1-9]/.test(char)
              ? String.fromCodePoint(0x2460 + Number(char) - 1)
              : char === '0'
                ? '⓪'
                : char,
      )
      .join(''),
  Squared: (text) => [...text.toUpperCase()].map((char) => (/[A-Z]/.test(char) ? String.fromCodePoint(0x1f130 + char.charCodeAt(0) - 65) : char)).join(''),
  'Full width': (text) => [...text].map((char) => (char === ' ' ? '\u3000' : char.charCodeAt(0) >= 33 && char.charCodeAt(0) <= 126 ? String.fromCharCode(char.charCodeAt(0) + 0xfee0) : char)).join(''),
  'Small caps': (text) => [...text].map((char) => (/[a-z]/.test(char) ? (SMALL_CAPS[char.charCodeAt(0) - 97] ?? char) : char)).join(''),
  'Upside down': (text) =>
    [...text]
      .reverse()
      .map((char) => UPSIDE[char] ?? UPSIDE[char.toLowerCase()] ?? char)
      .join(''),
  Strikethrough: (text) => [...text].map((char) => `${char}̶`).join(''),
  Underline: (text) => [...text].map((char) => `${char}̲`).join(''),
  Spaced: (text) => [...text].join(' '),
};

export default defineTextTool({
  input: { label: 'Text', sample: 'Benchtop 2026' },
  output: { label: 'Styles' },
  options: [{ key: 'style', label: 'Style', type: 'select', choices: [{ value: 'all', label: 'All styles' }, ...Object.keys(STYLES)], default: 'all' }],
  run(input, o) {
    if (input === '') return '';
    if (o.style !== 'all') return (STYLES[o.style] ?? ((text: string) => text))(input);
    return {
      output: Object.entries(STYLES)
        .map(([name, style]) => `${name}: ${style(input)}`)
        .join('\n'),
      info: 'These are Unicode characters, so they paste anywhere, but screen readers may read them letter by letter.',
    };
  },
});
