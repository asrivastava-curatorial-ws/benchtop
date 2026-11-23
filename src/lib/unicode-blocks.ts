/** Unicode blocks worth browsing, with their code point ranges (inclusive). */
export interface Block {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export const BLOCKS: readonly Block[] = [
  { name: 'Basic Latin', start: 0x0020, end: 0x007e },
  { name: 'Latin-1 Supplement', start: 0x00a0, end: 0x00ff },
  { name: 'Latin Extended-A', start: 0x0100, end: 0x017f },
  { name: 'Latin Extended-B', start: 0x0180, end: 0x024f },
  { name: 'IPA Extensions', start: 0x0250, end: 0x02af },
  { name: 'Spacing Modifier Letters', start: 0x02b0, end: 0x02ff },
  { name: 'Combining Diacritical Marks', start: 0x0300, end: 0x036f },
  { name: 'Greek and Coptic', start: 0x0370, end: 0x03ff },
  { name: 'Cyrillic', start: 0x0400, end: 0x04ff },
  { name: 'Armenian', start: 0x0530, end: 0x058f },
  { name: 'Hebrew', start: 0x0590, end: 0x05ff },
  { name: 'Arabic', start: 0x0600, end: 0x06ff },
  { name: 'Devanagari', start: 0x0900, end: 0x097f },
  { name: 'Bengali', start: 0x0980, end: 0x09ff },
  { name: 'Gurmukhi', start: 0x0a00, end: 0x0a7f },
  { name: 'Gujarati', start: 0x0a80, end: 0x0aff },
  { name: 'Oriya', start: 0x0b00, end: 0x0b7f },
  { name: 'Tamil', start: 0x0b80, end: 0x0bff },
  { name: 'Telugu', start: 0x0c00, end: 0x0c7f },
  { name: 'Kannada', start: 0x0c80, end: 0x0cff },
  { name: 'Malayalam', start: 0x0d00, end: 0x0d7f },
  { name: 'Sinhala', start: 0x0d80, end: 0x0dff },
  { name: 'Thai', start: 0x0e00, end: 0x0e7f },
  { name: 'Tibetan', start: 0x0f00, end: 0x0fff },
  { name: 'Georgian', start: 0x10a0, end: 0x10ff },
  { name: 'Hangul Jamo', start: 0x1100, end: 0x11ff },
  { name: 'Ethiopic', start: 0x1200, end: 0x137f },
  { name: 'Cherokee', start: 0x13a0, end: 0x13ff },
  { name: 'Runic', start: 0x16a0, end: 0x16ff },
  { name: 'Khmer', start: 0x1780, end: 0x17ff },
  { name: 'Mongolian', start: 0x1800, end: 0x18af },
  { name: 'Ol Chiki', start: 0x1c50, end: 0x1c7f },
  { name: 'Vedic Extensions', start: 0x1cd0, end: 0x1cff },
  { name: 'Phonetic Extensions', start: 0x1d00, end: 0x1d7f },
  { name: 'Latin Extended Additional', start: 0x1e00, end: 0x1eff },
  { name: 'Greek Extended', start: 0x1f00, end: 0x1fff },
  { name: 'General Punctuation', start: 0x2000, end: 0x206f },
  { name: 'Superscripts and Subscripts', start: 0x2070, end: 0x209f },
  { name: 'Currency Symbols', start: 0x20a0, end: 0x20cf },
  { name: 'Letterlike Symbols', start: 0x2100, end: 0x214f },
  { name: 'Number Forms', start: 0x2150, end: 0x218f },
  { name: 'Arrows', start: 0x2190, end: 0x21ff },
  { name: 'Mathematical Operators', start: 0x2200, end: 0x22ff },
  { name: 'Miscellaneous Technical', start: 0x2300, end: 0x23ff },
  { name: 'Control Pictures', start: 0x2400, end: 0x243f },
  { name: 'Enclosed Alphanumerics', start: 0x2460, end: 0x24ff },
  { name: 'Box Drawing', start: 0x2500, end: 0x257f },
  { name: 'Block Elements', start: 0x2580, end: 0x259f },
  { name: 'Geometric Shapes', start: 0x25a0, end: 0x25ff },
  { name: 'Miscellaneous Symbols', start: 0x2600, end: 0x26ff },
  { name: 'Dingbats', start: 0x2700, end: 0x27bf },
  { name: 'Miscellaneous Mathematical Symbols-A', start: 0x27c0, end: 0x27ef },
  { name: 'Supplemental Arrows-A', start: 0x27f0, end: 0x27ff },
  { name: 'Braille Patterns', start: 0x2800, end: 0x28ff },
  { name: 'Supplemental Arrows-B', start: 0x2900, end: 0x297f },
  { name: 'Miscellaneous Mathematical Symbols-B', start: 0x2980, end: 0x29ff },
  { name: 'Supplemental Mathematical Operators', start: 0x2a00, end: 0x2aff },
  { name: 'Miscellaneous Symbols and Arrows', start: 0x2b00, end: 0x2bff },
  { name: 'CJK Symbols and Punctuation', start: 0x3000, end: 0x303f },
  { name: 'Hiragana', start: 0x3040, end: 0x309f },
  { name: 'Katakana', start: 0x30a0, end: 0x30ff },
  { name: 'CJK Unified Ideographs', start: 0x4e00, end: 0x9fff },
  { name: 'Common Indic Number Forms', start: 0xa830, end: 0xa83f },
  { name: 'Devanagari Extended', start: 0xa8e0, end: 0xa8ff },
  { name: 'Hangul Syllables', start: 0xac00, end: 0xd7a3 },
  { name: 'Private Use Area', start: 0xe000, end: 0xf8ff },
  { name: 'Alphabetic Presentation Forms', start: 0xfb00, end: 0xfb4f },
  { name: 'Halfwidth and Fullwidth Forms', start: 0xff00, end: 0xffef },
  { name: 'Specials', start: 0xfff0, end: 0xfffd },
  { name: 'Linear B Syllabary', start: 0x10000, end: 0x1007f },
  { name: 'Phoenician', start: 0x10900, end: 0x1091f },
  { name: 'Shavian', start: 0x10450, end: 0x1047f },
  { name: 'Brahmi', start: 0x11000, end: 0x1107f },
  { name: 'Cuneiform', start: 0x12000, end: 0x123ff },
  { name: 'Egyptian Hieroglyphs', start: 0x13000, end: 0x1342f },
  { name: 'Musical Symbols', start: 0x1d100, end: 0x1d1ff },
  { name: 'Mathematical Alphanumeric Symbols', start: 0x1d400, end: 0x1d7ff },
  { name: 'Miscellaneous Symbols and Pictographs', start: 0x1f300, end: 0x1f5ff },
  { name: 'Emoticons', start: 0x1f600, end: 0x1f64f },
  { name: 'Transport and Map Symbols', start: 0x1f680, end: 0x1f6ff },
  { name: 'Supplemental Symbols and Pictographs', start: 0x1f900, end: 0x1f9ff },
  { name: 'Symbols and Pictographs Extended-A', start: 0x1fa70, end: 0x1faff },
];

export const blockOf = (cp: number) => BLOCKS.find((b) => cp >= b.start && cp <= b.end) ?? null;

/** Reads "अ", "U+0905", "0x905", "0905", "&#2309;" or "&#x905;" as a code point. */
export function parseCodePoint(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const hex = /^(?:u\+|0x|\\u\{?|&#x)?([0-9a-f]{2,6})\}?;?$/i.exec(t);
  if (hex && /^(u\+|0x|\\u|&#x)/i.test(t)) return Number.parseInt(hex[1] as string, 16);
  const dec = /^&#(\d{1,7});?$/.exec(t);
  if (dec) return Number(dec[1]);
  if (/^[0-9a-f]{4,6}$/i.test(t)) return Number.parseInt(t, 16);
  const first = t.codePointAt(0);
  return first === undefined ? null : first;
}

/** Ways to write a character in code. */
export function encodings(cp: number): { label: string; value: string }[] {
  const ch = String.fromCodePoint(cp);
  const hex = cp.toString(16).toUpperCase();
  const utf8 = [...new TextEncoder().encode(ch)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const utf16 = Array.from({ length: ch.length }, (_, i) => ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join(' ');
  return [
    { label: 'Code point', value: `U+${hex.padStart(4, '0')}` },
    { label: 'Decimal', value: String(cp) },
    { label: 'HTML', value: `&#x${hex};` },
    { label: 'CSS', value: `\\${hex}` },
    { label: 'JavaScript', value: cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}` },
    { label: 'Python', value: cp > 0xffff ? `\\U${hex.padStart(8, '0')}` : `\\u${hex.padStart(4, '0')}` },
    { label: 'UTF-8 bytes', value: utf8 },
    { label: 'UTF-16', value: utf16 },
  ];
}
