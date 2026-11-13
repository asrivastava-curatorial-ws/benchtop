/** Character-level inspection: code points, categories, scripts and hidden characters. */

/**
 * Names of characters that are invisible or easy to confuse (format controls,
 * spaces, variation selectors, a few combining marks), from Unicode 15.1.
 * Other characters are described by category and script.
 */
const NAMES: Record<number, string> = {
  32: 'SPACE',
  160: 'NO-BREAK SPACE',
  173: 'SOFT HYPHEN',
  768: 'COMBINING GRAVE ACCENT',
  769: 'COMBINING ACUTE ACCENT',
  771: 'COMBINING TILDE',
  776: 'COMBINING DIAERESIS',
  847: 'COMBINING GRAPHEME JOINER',
  1536: 'ARABIC NUMBER SIGN',
  1537: 'ARABIC SIGN SANAH',
  1538: 'ARABIC FOOTNOTE MARKER',
  1539: 'ARABIC SIGN SAFHA',
  1540: 'ARABIC SIGN SAMVAT',
  1541: 'ARABIC NUMBER MARK ABOVE',
  1564: 'ARABIC LETTER MARK',
  1757: 'ARABIC END OF AYAH',
  1807: 'SYRIAC ABBREVIATION MARK',
  2192: 'ARABIC POUND MARK ABOVE',
  2193: 'ARABIC PIASTRE MARK ABOVE',
  2274: 'ARABIC DISPUTED END OF AYAH',
  4447: 'HANGUL CHOSEONG FILLER',
  4448: 'HANGUL JUNGSEONG FILLER',
  5760: 'OGHAM SPACE MARK',
  6068: 'KHMER VOWEL INHERENT AQ',
  6069: 'KHMER VOWEL INHERENT AA',
  6158: 'MONGOLIAN VOWEL SEPARATOR',
  8192: 'EN QUAD',
  8193: 'EM QUAD',
  8194: 'EN SPACE',
  8195: 'EM SPACE',
  8196: 'THREE-PER-EM SPACE',
  8197: 'FOUR-PER-EM SPACE',
  8198: 'SIX-PER-EM SPACE',
  8199: 'FIGURE SPACE',
  8200: 'PUNCTUATION SPACE',
  8201: 'THIN SPACE',
  8202: 'HAIR SPACE',
  8203: 'ZERO WIDTH SPACE',
  8204: 'ZERO WIDTH NON-JOINER',
  8205: 'ZERO WIDTH JOINER',
  8206: 'LEFT-TO-RIGHT MARK',
  8207: 'RIGHT-TO-LEFT MARK',
  8232: 'LINE SEPARATOR',
  8233: 'PARAGRAPH SEPARATOR',
  8234: 'LEFT-TO-RIGHT EMBEDDING',
  8235: 'RIGHT-TO-LEFT EMBEDDING',
  8236: 'POP DIRECTIONAL FORMATTING',
  8237: 'LEFT-TO-RIGHT OVERRIDE',
  8238: 'RIGHT-TO-LEFT OVERRIDE',
  8239: 'NARROW NO-BREAK SPACE',
  8287: 'MEDIUM MATHEMATICAL SPACE',
  8288: 'WORD JOINER',
  8289: 'FUNCTION APPLICATION',
  8290: 'INVISIBLE TIMES',
  8291: 'INVISIBLE SEPARATOR',
  8292: 'INVISIBLE PLUS',
  8294: 'LEFT-TO-RIGHT ISOLATE',
  8295: 'RIGHT-TO-LEFT ISOLATE',
  8296: 'FIRST STRONG ISOLATE',
  8297: 'POP DIRECTIONAL ISOLATE',
  8298: 'INHIBIT SYMMETRIC SWAPPING',
  8299: 'ACTIVATE SYMMETRIC SWAPPING',
  8300: 'INHIBIT ARABIC FORM SHAPING',
  8301: 'ACTIVATE ARABIC FORM SHAPING',
  8302: 'NATIONAL DIGIT SHAPES',
  8303: 'NOMINAL DIGIT SHAPES',
  8419: 'COMBINING ENCLOSING KEYCAP',
  10240: 'BRAILLE PATTERN BLANK',
  12288: 'IDEOGRAPHIC SPACE',
  12644: 'HANGUL FILLER',
  65024: 'VARIATION SELECTOR-1',
  65025: 'VARIATION SELECTOR-2',
  65026: 'VARIATION SELECTOR-3',
  65027: 'VARIATION SELECTOR-4',
  65028: 'VARIATION SELECTOR-5',
  65029: 'VARIATION SELECTOR-6',
  65030: 'VARIATION SELECTOR-7',
  65031: 'VARIATION SELECTOR-8',
  65032: 'VARIATION SELECTOR-9',
  65033: 'VARIATION SELECTOR-10',
  65034: 'VARIATION SELECTOR-11',
  65035: 'VARIATION SELECTOR-12',
  65036: 'VARIATION SELECTOR-13',
  65037: 'VARIATION SELECTOR-14',
  65038: 'VARIATION SELECTOR-15',
  65039: 'VARIATION SELECTOR-16',
  65279: 'ZERO WIDTH NO-BREAK SPACE',
  65440: 'HALFWIDTH HANGUL FILLER',
  65529: 'INTERLINEAR ANNOTATION ANCHOR',
  65530: 'INTERLINEAR ANNOTATION SEPARATOR',
  65531: 'INTERLINEAR ANNOTATION TERMINATOR',
  65532: 'OBJECT REPLACEMENT CHARACTER',
  65533: 'REPLACEMENT CHARACTER',
  69821: 'KAITHI NUMBER SIGN',
  69837: 'KAITHI NUMBER SIGN ABOVE',
  78896: 'EGYPTIAN HIEROGLYPH VERTICAL JOINER',
  78897: 'EGYPTIAN HIEROGLYPH HORIZONTAL JOINER',
  78898: 'EGYPTIAN HIEROGLYPH INSERT AT TOP START',
  78899: 'EGYPTIAN HIEROGLYPH INSERT AT BOTTOM START',
  78900: 'EGYPTIAN HIEROGLYPH INSERT AT TOP END',
  78901: 'EGYPTIAN HIEROGLYPH INSERT AT BOTTOM END',
  78902: 'EGYPTIAN HIEROGLYPH OVERLAY MIDDLE',
  78903: 'EGYPTIAN HIEROGLYPH BEGIN SEGMENT',
  78904: 'EGYPTIAN HIEROGLYPH END SEGMENT',
  78905: 'EGYPTIAN HIEROGLYPH INSERT AT MIDDLE',
  78906: 'EGYPTIAN HIEROGLYPH INSERT AT TOP',
  78907: 'EGYPTIAN HIEROGLYPH INSERT AT BOTTOM',
  78908: 'EGYPTIAN HIEROGLYPH BEGIN ENCLOSURE',
  78909: 'EGYPTIAN HIEROGLYPH END ENCLOSURE',
  78910: 'EGYPTIAN HIEROGLYPH BEGIN WALLED ENCLOSURE',
  78911: 'EGYPTIAN HIEROGLYPH END WALLED ENCLOSURE',
  113824: 'SHORTHAND FORMAT LETTER OVERLAP',
  113825: 'SHORTHAND FORMAT CONTINUING OVERLAP',
  113826: 'SHORTHAND FORMAT DOWN STEP',
  113827: 'SHORTHAND FORMAT UP STEP',
  119155: 'MUSICAL SYMBOL BEGIN BEAM',
  119156: 'MUSICAL SYMBOL END BEAM',
  119157: 'MUSICAL SYMBOL BEGIN TIE',
  119158: 'MUSICAL SYMBOL END TIE',
  119159: 'MUSICAL SYMBOL BEGIN SLUR',
  119160: 'MUSICAL SYMBOL END SLUR',
  119161: 'MUSICAL SYMBOL BEGIN PHRASE',
  119162: 'MUSICAL SYMBOL END PHRASE',
  127995: 'EMOJI MODIFIER FITZPATRICK TYPE-1-2',
  127996: 'EMOJI MODIFIER FITZPATRICK TYPE-3',
  127997: 'EMOJI MODIFIER FITZPATRICK TYPE-4',
  127998: 'EMOJI MODIFIER FITZPATRICK TYPE-5',
  127999: 'EMOJI MODIFIER FITZPATRICK TYPE-6',
  917505: 'LANGUAGE TAG',
  917536: 'TAG SPACE',
  917537: 'TAG EXCLAMATION MARK',
  917538: 'TAG QUOTATION MARK',
  917539: 'TAG NUMBER SIGN',
  917540: 'TAG DOLLAR SIGN',
  917541: 'TAG PERCENT SIGN',
  917542: 'TAG AMPERSAND',
  917543: 'TAG APOSTROPHE',
  917544: 'TAG LEFT PARENTHESIS',
  917545: 'TAG RIGHT PARENTHESIS',
  917546: 'TAG ASTERISK',
  917547: 'TAG PLUS SIGN',
  917548: 'TAG COMMA',
  917549: 'TAG HYPHEN-MINUS',
  917550: 'TAG FULL STOP',
  917551: 'TAG SOLIDUS',
  917552: 'TAG DIGIT ZERO',
  917553: 'TAG DIGIT ONE',
  917554: 'TAG DIGIT TWO',
  917555: 'TAG DIGIT THREE',
  917556: 'TAG DIGIT FOUR',
  917557: 'TAG DIGIT FIVE',
  917558: 'TAG DIGIT SIX',
  917559: 'TAG DIGIT SEVEN',
  917560: 'TAG DIGIT EIGHT',
  917561: 'TAG DIGIT NINE',
  917562: 'TAG COLON',
  917563: 'TAG SEMICOLON',
  917564: 'TAG LESS-THAN SIGN',
  917565: 'TAG EQUALS SIGN',
  917566: 'TAG GREATER-THAN SIGN',
  917567: 'TAG QUESTION MARK',
  917568: 'TAG COMMERCIAL AT',
  917569: 'TAG LATIN CAPITAL LETTER A',
  917570: 'TAG LATIN CAPITAL LETTER B',
  917571: 'TAG LATIN CAPITAL LETTER C',
  917572: 'TAG LATIN CAPITAL LETTER D',
  917573: 'TAG LATIN CAPITAL LETTER E',
  917574: 'TAG LATIN CAPITAL LETTER F',
  917575: 'TAG LATIN CAPITAL LETTER G',
  917576: 'TAG LATIN CAPITAL LETTER H',
  917577: 'TAG LATIN CAPITAL LETTER I',
  917578: 'TAG LATIN CAPITAL LETTER J',
  917579: 'TAG LATIN CAPITAL LETTER K',
  917580: 'TAG LATIN CAPITAL LETTER L',
  917581: 'TAG LATIN CAPITAL LETTER M',
  917582: 'TAG LATIN CAPITAL LETTER N',
  917583: 'TAG LATIN CAPITAL LETTER O',
  917584: 'TAG LATIN CAPITAL LETTER P',
  917585: 'TAG LATIN CAPITAL LETTER Q',
  917586: 'TAG LATIN CAPITAL LETTER R',
  917587: 'TAG LATIN CAPITAL LETTER S',
  917588: 'TAG LATIN CAPITAL LETTER T',
  917589: 'TAG LATIN CAPITAL LETTER U',
  917590: 'TAG LATIN CAPITAL LETTER V',
  917591: 'TAG LATIN CAPITAL LETTER W',
  917592: 'TAG LATIN CAPITAL LETTER X',
  917593: 'TAG LATIN CAPITAL LETTER Y',
  917594: 'TAG LATIN CAPITAL LETTER Z',
  917595: 'TAG LEFT SQUARE BRACKET',
  917596: 'TAG REVERSE SOLIDUS',
  917597: 'TAG RIGHT SQUARE BRACKET',
  917598: 'TAG CIRCUMFLEX ACCENT',
  917599: 'TAG LOW LINE',
  917600: 'TAG GRAVE ACCENT',
  917601: 'TAG LATIN SMALL LETTER A',
  917602: 'TAG LATIN SMALL LETTER B',
  917603: 'TAG LATIN SMALL LETTER C',
  917604: 'TAG LATIN SMALL LETTER D',
  917605: 'TAG LATIN SMALL LETTER E',
  917606: 'TAG LATIN SMALL LETTER F',
  917607: 'TAG LATIN SMALL LETTER G',
  917608: 'TAG LATIN SMALL LETTER H',
  917609: 'TAG LATIN SMALL LETTER I',
  917610: 'TAG LATIN SMALL LETTER J',
  917611: 'TAG LATIN SMALL LETTER K',
  917612: 'TAG LATIN SMALL LETTER L',
  917613: 'TAG LATIN SMALL LETTER M',
  917614: 'TAG LATIN SMALL LETTER N',
  917615: 'TAG LATIN SMALL LETTER O',
  917616: 'TAG LATIN SMALL LETTER P',
  917617: 'TAG LATIN SMALL LETTER Q',
  917618: 'TAG LATIN SMALL LETTER R',
  917619: 'TAG LATIN SMALL LETTER S',
  917620: 'TAG LATIN SMALL LETTER T',
  917621: 'TAG LATIN SMALL LETTER U',
  917622: 'TAG LATIN SMALL LETTER V',
  917623: 'TAG LATIN SMALL LETTER W',
  917624: 'TAG LATIN SMALL LETTER X',
  917625: 'TAG LATIN SMALL LETTER Y',
  917626: 'TAG LATIN SMALL LETTER Z',
  917627: 'TAG LEFT CURLY BRACKET',
  917628: 'TAG VERTICAL LINE',
  917629: 'TAG RIGHT CURLY BRACKET',
  917630: 'TAG TILDE',
  917631: 'CANCEL TAG',
};

const CONTROL_NAMES: Record<number, string> = {
  0: 'NULL',
  7: 'BELL',
  8: 'BACKSPACE',
  9: 'CHARACTER TABULATION',
  10: 'LINE FEED',
  11: 'LINE TABULATION',
  12: 'FORM FEED',
  13: 'CARRIAGE RETURN',
  27: 'ESCAPE',
  127: 'DELETE',
  133: 'NEXT LINE',
};

const CATEGORIES: [string, string][] = [
  ['Lu', 'Uppercase letter'],
  ['Ll', 'Lowercase letter'],
  ['Lt', 'Titlecase letter'],
  ['Lm', 'Modifier letter'],
  ['Lo', 'Other letter'],
  ['Mn', 'Non-spacing mark'],
  ['Mc', 'Spacing mark'],
  ['Me', 'Enclosing mark'],
  ['Nd', 'Decimal digit'],
  ['Nl', 'Letter number'],
  ['No', 'Other number'],
  ['Pc', 'Connector punctuation'],
  ['Pd', 'Dash'],
  ['Ps', 'Opening punctuation'],
  ['Pe', 'Closing punctuation'],
  ['Pi', 'Initial quote'],
  ['Pf', 'Final quote'],
  ['Po', 'Other punctuation'],
  ['Sm', 'Math symbol'],
  ['Sc', 'Currency symbol'],
  ['Sk', 'Modifier symbol'],
  ['So', 'Other symbol'],
  ['Zs', 'Space separator'],
  ['Zl', 'Line separator'],
  ['Zp', 'Paragraph separator'],
  ['Cc', 'Control'],
  ['Cf', 'Format (invisible)'],
  ['Cs', 'Surrogate'],
  ['Co', 'Private use'],
  ['Cn', 'Unassigned'],
];
const CATEGORY_TESTS = CATEGORIES.map(([code, label]) => [code, label, new RegExp(`^\\p{gc=${code}}$`, 'u')] as const);

const SCRIPTS = [
  'Latin',
  'Greek',
  'Cyrillic',
  'Armenian',
  'Hebrew',
  'Arabic',
  'Syriac',
  'Thaana',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Thai',
  'Lao',
  'Tibetan',
  'Myanmar',
  'Georgian',
  'Hangul',
  'Ethiopic',
  'Cherokee',
  'Khmer',
  'Mongolian',
  'Hiragana',
  'Katakana',
  'Bopomofo',
  'Han',
  'Ol_Chiki',
  'Common',
  'Inherited',
];
const SCRIPT_TESTS = SCRIPTS.map((script) => [script.replace('_', ' '), new RegExp(`^\\p{Script=${script}}$`, 'u')] as const);

export interface CharInfo {
  readonly char: string;
  readonly codePoint: number;
  readonly hex: string;
  readonly name: string;
  readonly category: string;
  readonly categoryCode: string;
  readonly script: string;
  readonly utf8: string;
  readonly utf16: string;
  readonly invisible: boolean;
  readonly bidi: boolean;
}

const BIDI_CONTROLS = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

export function describeChar(char: string): CharInfo {
  const codePoint = char.codePointAt(0) as number;
  const [categoryCode, category] = CATEGORY_TESTS.find(([, , test]) => test.test(char)) ?? ['Cn', 'Unassigned'];
  const script = SCRIPT_TESTS.find(([, test]) => test.test(char))?.[0] ?? 'Other';
  const utf8 = [...new TextEncoder().encode(char)].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const utf16 = Array.from({ length: char.length }, (_, i) => char.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join(' ');
  const invisible =
    categoryCode === 'Cf' ||
    categoryCode === 'Cc' ||
    categoryCode === 'Zl' ||
    categoryCode === 'Zp' ||
    (categoryCode === 'Zs' && codePoint !== 0x20) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    codePoint === 0x115f ||
    codePoint === 0x1160 ||
    codePoint === 0x3164 ||
    codePoint === 0xffa0;
  return {
    char,
    codePoint,
    hex: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
    name: NAMES[codePoint] ?? CONTROL_NAMES[codePoint] ?? (codePoint >= 0xe0100 && codePoint <= 0xe01ef ? `VARIATION SELECTOR-${codePoint - 0xe0100 + 17}` : ''),
    category,
    categoryCode,
    script,
    utf8,
    utf16,
    invisible,
    bidi: BIDI_CONTROLS.has(codePoint),
  };
}

/** How a character is shown in a listing: invisible ones get a readable placeholder. */
export function visible(info: CharInfo): string {
  if (info.codePoint === 0x20) return '␠';
  if (info.codePoint === 0x0a) return '␊';
  if (info.codePoint === 0x0d) return '␍';
  if (info.codePoint === 0x09) return '␉';
  if (info.invisible || info.categoryCode.startsWith('M')) return info.categoryCode.startsWith('M') ? `◌${info.char}` : '·';
  return info.char;
}

export interface TextReport {
  readonly chars: readonly CharInfo[];
  readonly graphemes: number;
  readonly utf8Bytes: number;
  readonly utf16Units: number;
  readonly invisible: readonly CharInfo[];
  readonly bidi: readonly CharInfo[];
  readonly scripts: readonly string[];
  readonly nfc: boolean;
  readonly nfkcChanges: boolean;
}

export function inspectText(text: string, limit = 5000): TextReport {
  const all = [...text];
  const chars = all.slice(0, limit).map(describeChar);
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const scripts = [...new Set(chars.map((c) => c.script).filter((s) => s !== 'Common' && s !== 'Inherited'))];
  return {
    chars,
    graphemes: segmenter ? [...segmenter.segment(text)].length : all.length,
    utf8Bytes: new TextEncoder().encode(text).length,
    utf16Units: text.length,
    invisible: chars.filter((c) => c.invisible && c.codePoint !== 0x0a && c.codePoint !== 0x0d && c.codePoint !== 0x09),
    bidi: chars.filter((c) => c.bidi),
    scripts,
    nfc: text === text.normalize('NFC'),
    nfkcChanges: text !== text.normalize('NFKC'),
  };
}

/** Removes invisible characters (keeping tabs and line breaks) and applies a normalisation form. */
export function cleanText(text: string, form: 'NFC' | 'NFKC' | 'none', keepJoiners: boolean): string {
  let out = '';
  for (const char of text) {
    const info = describeChar(char);
    const joiner = info.codePoint === 0x200d || (info.codePoint >= 0xfe00 && info.codePoint <= 0xfe0f);
    if (info.invisible && !(keepJoiners && joiner) && info.codePoint !== 0x0a && info.codePoint !== 0x0d && info.codePoint !== 0x09) {
      // Unusual spaces become ordinary spaces; everything else invisible is removed.
      if (info.categoryCode === 'Zs') out += ' ';
      continue;
    }
    out += char;
  }
  return form === 'none' ? out : out.normalize(form);
}
