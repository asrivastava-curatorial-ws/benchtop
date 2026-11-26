import { describe, expect, it } from 'vitest';
import {
  convertIndic,
  detectIndicScript,
  ethiopic,
  fromDevanagari,
  hangulCandidates,
  hasNativeDigits,
  itransToDevanagari,
  KEYBOARDS,
  keyboardFor,
  olChiki,
  punctuate,
  romanize,
  TYPING_LANGUAGES,
  telex,
  toDevanagari,
  transliterate,
  transliterateParts,
  wordCandidates,
} from '../../src/lib/transliterate';

// Expected strings are normalized so the tests do not depend on how nukta letters were stored.
const n = (value: string) => value.normalize('NFC');
const first = (language: string, word: string) => wordCandidates(language, word)[0];

// The cases below are Universal Transliterator's own tests, so both apps keep spelling alike.
describe('ITRANS / IAST to Devanagari', () => {
  it('writes Hindi the way it is spelt', () => {
    expect(itransToDevanagari('namaste', false)).toBe(n('नमस्ते'));
    expect(itransToDevanagari('bhaarat', false)).toBe(n('भारत'));
    expect(itransToDevanagari('shakti', false)).toBe(n('शक्ति'));
    expect(itransToDevanagari('chaay', false)).toBe(n('चाय'));
    expect(itransToDevanagari('kShatriya', false)).toBe(n('क्षत्रिय'));
    expect(itransToDevanagari('j~naana', false)).toBe(n('ज्ञान'));
    expect(itransToDevanagari('hindii', false)).toBe(n('हिन्दी'));
    expect(itransToDevanagari('doodh', false)).toBe(n('दूध'));
    expect(itransToDevanagari('zindagii', false)).toBe(n('ज़िन्दगी'));
  });

  it('adds the virama to final consonants for Sanskrit', () => {
    expect(itransToDevanagari('saMskRRitam', true)).toBe(n('संस्कृतम्'));
    expect(itransToDevanagari('bhaarat', true)).toBe(n('भारत्'));
    expect(itransToDevanagari('raamaH', true)).toBe(n('रामः'));
    expect(itransToDevanagari('OM namaH shivaaya', true)).toBe(n('ॐ नमः शिवाय'));
    expect(itransToDevanagari('so.aham', true)).toBe(n('सोऽहम्'));
  });

  it('reads IAST letters, composed or not', () => {
    expect(itransToDevanagari('saṃskṛtam', true)).toBe(n('संस्कृतम्'));
    expect(itransToDevanagari('kṛṣṇa', false)).toBe(n('कृष्ण'));
    expect(itransToDevanagari('śiva', false)).toBe(n('शिव'));
    expect(itransToDevanagari('rāma', false)).toBe(n('राम'));
  });

  it('has short and long e and o for the Dravidian languages', () => {
    const kannada = (text: string) => fromDevanagari(itransToDevanagari(text, false, true), 'Kannada');
    expect(kannada('maaDuttEne')).toBe(n('ಮಾಡುತ್ತೇನೆ'));
    expect(kannada('kOTe')).toBe(n('ಕೋಟೆ'));
  });
});

describe('script to script', () => {
  it('converts Devanagari to the other scripts with their own spelling', () => {
    const hindi = 'नमस्ते भारत';
    expect(fromDevanagari(hindi, 'Kannada')).toBe(n('ನಮಸ್ತೇ ಭಾರತ'));
    expect(fromDevanagari(hindi, 'Telugu')).toBe(n('నమస్తే భారత'));
    expect(fromDevanagari(hindi, 'Bengali')).toBe(n('নমস্তে ভারত'));
    expect(fromDevanagari(hindi, 'Tamil')).toBe(n('நமஸ்தே பாரத'));
    expect(fromDevanagari(hindi, 'Gujarati')).toBe(n('નમસ્તે ભારત'));
    expect(fromDevanagari(hindi, 'Sinhala')).toBe(n('නමස්තේ භාරත'));
    expect(fromDevanagari('पक्का', 'Gurmukhi')).toBe(n('ਪੱਕਾ'));
    expect(fromDevanagari('नमस्ते', 'Gurmukhi')).toBe(n('ਨਮਸਤੇ'));
    expect(fromDevanagari('विश्व', 'Odia')).toBe(n('ବିଶ୍ୱ'));
    expect(fromDevanagari('अवन्', 'Malayalam')).toBe(n('അവൻ'));
    expect(fromDevanagari('रवि', 'Assamese')).toBe(n('ৰৱি'));
    expect(fromDevanagari('१२३', 'Kannada')).toBe(n('೧೨೩'));
  });

  it('reads every script back into Devanagari', () => {
    expect(toDevanagari('ನಮಸ್ತೇ')).toBe(n('नमस्ते'));
    expect(toDevanagari('ਪੱਕਾ')).toBe(n('पक्का'));
    expect(toDevanagari('നന്ദി')).toBe(n('नन्दि'));
    expect(toDevanagari('അവൻ')).toBe(n('अवन्'));
    expect(toDevanagari('ভারত')).toBe(n('भारत'));
    expect(toDevanagari('ভারত hello')).toBe(n('भारत hello'));
    expect(toDevanagari('නමස්තේ')).toBe(n('नमस्ते'));
  });

  it('converts between any two scripts', () => {
    expect(convertIndic('ನಮಸ್ತೇ', 'Bengali')).toBe(n('নমস্তে'));
    expect(convertIndic('নমস্তে, ಭಾರತ!', 'Devanagari')).toBe(n('नमस्ते, भारत!'));
  });

  it('finds the script a text is mostly in', () => {
    expect(detectIndicScript('ನಮಸ್ತೇ abc')).toBe('Kannada');
    expect(detectIndicScript('hello')).toBeNull();
  });
});

describe('romanization', () => {
  it('writes IAST, ISO 15919, ITRANS and a plain spelling', () => {
    expect(romanize('संस्कृतम्', 'iast')).toBe(n('saṃskṛtam'));
    expect(romanize('संस्कृतम्', 'iso15919')).toBe(n('saṁskr̥tam'));
    expect(romanize('कृष्ण', 'itrans')).toBe(n('kRRiShNa'));
    expect(romanize('अभिष्ट श्रीवास्तव', 'casual')).toBe(n('abhisht shrivastav'));
    expect(romanize('भारत', 'casual')).toBe(n('bharat'));
    expect(romanize('न', 'casual')).toBe(n('na'));
    expect(romanize('ನಮಸ್ತೇ', 'iast')).toBe(n('namaste'));
    expect(romanize('संबंध', 'casual')).toBe(n('sambandh'));
  });

  it('round-trips through ITRANS', () => {
    for (const word of ['namaste', 'kRRiShNa', 'saMskRRitam', 'j~nAna', 'bhagavadgItA']) {
      const devanagari = itransToDevanagari(word, true);
      expect(itransToDevanagari(romanize(devanagari, 'itrans'), true), word).toBe(devanagari);
    }
  });
});

describe('alphabets and abjads', () => {
  it('types Greek, with final sigma and accents', () => {
    expect(first('el', 'kalimera')).toBe('καλιμερα');
    expect(first('el', 'logos')).toBe('λογος');
    expect(first('el', 'Athina')).toBe('Αθινα');
    expect(first('el', "kalhme'ra")).toBe('καλημέρα');
  });

  it('types the Cyrillic languages', () => {
    expect(first('ru', 'privet')).toBe('привет');
    expect(first('ru', 'Moskva')).toBe('Москва');
    expect(first('ru', 'zdravstvuyte')).toBe('здравствуйте');
    expect(transliterate('shch', 'ru')).toBe('щ');
    expect(first('uk', 'Kyjiv')).toBe('Київ');
    expect(first('uk', 'dyakuyu')).toBe('дякую');
    expect(first('bg', 'Bylgariya')).toBe('България');
    expect(first('bg', 'zdravey')).toBe('здравей');
    expect(first('sr', 'Beograd')).toBe('Београд');
    expect(first('sr', 'ljubav')).toBe('љубав');
    expect(first('mk', 'Makedonija')).toBe('Македонија');
    expect(first('be', 'Minsk')).toBe('Мінск');
  });

  it('types Armenian and Georgian', () => {
    expect(first('hy', 'Hayastan')).toBe('Հայաստան');
    expect(first('hy', 'Yerevan')).toBe('Երևան');
    expect(first('ka', 'gamarjoba')).toBe('გამარჯობა');
    expect(first('ka', 'tbilisi')).toBe('თბილისი');
    expect(first('ka', 'sakartvelo')).toBe('საქართველო');
  });

  it('types Hebrew, Arabic and Persian, offering the other vowel spellings', () => {
    expect(first('he', 'shalom')).toBe('שלום');
    expect(first('he', 'toda')).toBe('תודה');
    expect(first('ar', 'mar7aba')).toBe('مرحبا');
    expect(first('ar', '7abibi')).toBe('حبيبي');
    expect(first('ar', 'salaam')).toBe('سلام');
    expect(first('ar', 'allah')).toBe('الله');
    expect(first('ar', 'al-3arabiya')).toBe('العربية');
    expect(first('ar', '3arabiya')).toBe('عربية');
    expect(first('ar', 'ash-shams')).toBe('الشمس');
    expect(first('ar', 'al-qamar')).toBe('القمر');
    expect(first('ar', 'suwar')).toBe('سور');
    expect(wordCandidates('ar', '3alaykum')).toContain('عليكم');
    expect(wordCandidates('ar', 'quwwa')).toContain('قوة');
    expect(wordCandidates('ar', 'madrasa')).toContain('مدرسة');
    expect(first('fa', 'siyah')).toBe('سیاه');
    expect(first('fa', 'salaam')).toBe('سلام');
    expect(first('fa', 'iran')).toBe('ایران');
    expect(first('fa', 'khaane')).toBe('خانه');
    expect(first('fa', 'farsi')).toBe('فارسی');
    expect(first('fa', 'mamnoon')).toBe('ممنون');
    expect(wordCandidates('fa', 'tehran')).toContain('تهران');
  });
});

describe('Korean, Vietnamese, Ge’ez and Ol Chiki', () => {
  const korean = (word: string) => hangulCandidates(word)[0];

  it('builds Hangul syllables and offers other splits', () => {
    expect(korean('annyeonghaseyo')).toBe('안녕하세요');
    expect(korean('saranghae')).toBe('사랑해');
    expect(korean('hangeul')).toBe('한글');
    expect(korean('hanguk')).toBe('한국');
    expect(korean('seoul')).toBe('서울');
    expect(korean('kimchi')).toBe('킴치');
    expect(korean('isseoyo')).toBe('있어요');
    expect(korean('akka')).toBe('아까');
    expect(korean('hoesa')).toBe('회사');
    expect(korean('gwa')).toBe('과');
    expect(korean('jung-ang')).toBe('중앙');
    expect(korean("yeong'eo")).toBe('영어');
    expect(hangulCandidates('yeongeo')).toContain('영어');
    expect(hangulCandidates('xyz')).toEqual([]);
    expect(hangulCandidates('strength')).toEqual([]);
  });

  it('types Vietnamese in Telex and leaves English alone', () => {
    const t = (word: string) => telex(word) ?? word;
    expect(t('tieengs')).toBe('tiếng');
    expect(t('Vieetj')).toBe('Việt');
    expect(t('xin')).toBe('xin');
    expect(t('chaof')).toBe('chào');
    expect(t('ddaau')).toBe('đâu');
    expect(t('nguwowif')).toBe('người');
    expect(t('hoaf')).toBe('hòa');
    expect(t('toans')).toBe('toán');
    expect(t('quas')).toBe('quá');
    expect(t('gias')).toBe('giá');
    expect(t('Haf')).toBe('Hà');
    expect(t('Nooij')).toBe('Nội');
    expect(t('cuwr')).toBe('cử');
    expect(t('khuyeen')).toBe('khuyên');
    expect(telex('ass')).toBeNull();
    expect(t('Vieejt')).toBe('Việt');
    expect(t('dduwowngf')).toBe('đường');
    expect(telex('browser')).toBeNull();
    expect(telex('class')).toBeNull();
    expect(t('hello')).toBe('hello');
  });

  it('writes Amharic in Ge’ez syllables', () => {
    expect(ethiopic('selam')).toBe('ሰላም');
    expect(ethiopic('amarnya')).toBe('አማርኛ');
    expect(ethiopic('amarinya')).toBe('አማሪኛ');
    expect(ethiopic('addis')).toBe('አዲስ');
    expect(ethiopic('abeba')).toBe('አበባ');
    expect(ethiopic('ityoPya')).toBe('ኢትዮጵያ');
    expect(ethiopic('gwa')).toBe('ጓ');
    expect(ethiopic('lwa')).toBe('ሏ');
  });

  it('writes Santali in Ol Chiki', () => {
    expect(olChiki('santaRi')).toBe('ᱥᱟᱱᱛᱟᱲᱤ');
    expect(olChiki('ol')).toBe('ᱚᱞ');
    expect(olChiki('chiki')).toBe('ᱪᱤᱠᱤ');
    expect(olChiki('johar')).toBe('ᱡᱚᱦᱟᱨ');
  });
});

describe('whole texts', () => {
  it('converts words and keeps braces, links and punctuation in the script’s forms', () => {
    expect(transliterate('kyaa haal hai | {OK}', 'hi')).toBe(n('क्या हाल है । OK'));
    expect(transliterate('tieengs Vieetj', 'vi')).toBe('tiếng Việt');
    expect(transliterate('annyeonghaseyo', 'ko')).toBe('안녕하세요');
    expect(transliterate('selam.', 'am')).toBe('ሰላም።');
    expect(transliterate('namaste https://vitm.gov.in/a. abc@vitm.gov.in', 'hi')).toBe(n('नमस्ते https://vitm.gov.in/a. abc@vitm.gov.in'));
    expect(transliterate('{{x}', 'hi')).toBe(n('{क्ष}'));
    expect(transliterate('hello 2026!', 'th')).toBe('hello 2026!');
  });

  it('turns the digits and dandas into the script’s own on request', () => {
    expect(punctuate('hi', ' 2026 ||', true)).toBe(' २०२६ ॥');
    expect(punctuate('ar', '? 12', true)).toBe('؟ ١٢');
    expect(punctuate('el', 'ti?', false)).toBe('ti;');
    expect(transliterate('saal 2026', 'hi', { nativeDigits: true })).toBe(n('साल २०२६'));
    expect(hasNativeDigits('hi')).toBe(true);
    expect(hasNativeDigits('ru')).toBe(false);
  });

  it('lists other spellings and remembers the one chosen', () => {
    const parts = transliterateParts('madrasa kabira', 'ar');
    const word = parts.find((part) => part.source === 'madrasa');
    expect(word?.options.length).toBeGreaterThan(1);
    expect(word?.options).toContain('مدرسة');
    expect(transliterate('madrasa', 'ar', { choices: { madrasa: 'مدرسة' } })).toBe('مدرسة');
    // A remembered spelling that is not among the word's spellings is ignored.
    expect(transliterate('madrasa', 'ar', { choices: { madrasa: 'x' } })).toBe(first('ar', 'madrasa'));
  });

  it('spells every language’s example sensibly', () => {
    const expected: Record<string, string> = {
      hi: 'नमस्ते, मेरा नाम अभिष्ट है',
      sa: 'वसुधैव कुटुम्बकम्',
      bn: 'আমার সোনার বাংলা',
      as: 'অসম, গুৱাহাটী',
      gu: 'કેમ છો',
      pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ',
      or: 'ନମସ୍କାର',
      ta: 'வணக்கம்',
      te: 'నమస్కారం',
      kn: 'ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಿ',
      ml: 'നമസ്കാരം',
      si: 'ආයුබෝවන්',
      sat: 'ᱡᱚᱦᱟᱨ, ᱥᱟᱱᱛᱟᱲᱤ',
      ko: '안녕하세요, 사랑해',
      ar: 'مرحبا، سلام',
      ru: 'привет, как дела',
      am: 'ሰላም፣ አማርኛ',
    };
    for (const language of TYPING_LANGUAGES) {
      const result = transliterate(language.example, language.id);
      if (language.engine === 'keyboard') expect(language.example).toBe('');
      else expect(result, language.id).not.toBe(language.example);
      if (expected[language.id]) expect(result, language.id).toBe(n(expected[language.id] as string));
    }
  });
});

describe('keyboards', () => {
  it('counts the languages the documentation names', () => {
    const count = (engine: string) => TYPING_LANGUAGES.filter((l) => l.engine === engine).length;
    expect(TYPING_LANGUAGES.length).toBe(40);
    expect(count('exact') + count('rules')).toBe(35);
    expect(count('keyboard')).toBe(5);
    expect(new Set(TYPING_LANGUAGES.map((l) => l.id)).size).toBe(40);
  });

  it('has a keyboard for every language, with vowel signs for the Indian scripts', () => {
    expect(KEYBOARDS.length).toBe(31);
    for (const language of TYPING_LANGUAGES) expect(keyboardFor(language.id).layout, language.id).not.toBeNull();
    expect(keyboardFor('hi').marks).toContain('्');
    expect(keyboardFor('ar').layout?.rtl).toBe(true);
    const ids = new Set(KEYBOARDS.map((k) => k.id));
    expect(ids.size).toBe(KEYBOARDS.length);
  });
});
