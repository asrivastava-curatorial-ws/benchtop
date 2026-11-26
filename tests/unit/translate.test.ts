import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  detectLanguage,
  indicTransKnows,
  MODEL_CATALOGUE,
  modelKnows,
  modelName,
  plan,
  rebuild,
  sentences,
  subtitleFormat,
  subtitlePlan,
  TRANSLATION_LANGUAGES,
  translatePieces,
  translationLanguage,
  translationRequest,
} from '../../src/lib/translate';

const upper = (pieces: readonly string[]) => pieces.map((p) => p.toUpperCase());

describe('text translator', () => {
  it('offers English and all 22 scheduled languages of India', () => {
    const indic = TRANSLATION_LANGUAGES.filter((l) => indicTransKnows(l.code));
    expect(indic).toHaveLength(23);
    expect(new Set(TRANSLATION_LANGUAGES.map((l) => l.code)).size).toBe(TRANSLATION_LANGUAGES.length);
    expect(translationLanguage('sat').flores).toBe('sat_Olck');
    expect(indicTransKnows('fr')).toBe(false);
  });

  it('offers the world’s major languages too, each with its FLORES-200 code', () => {
    for (const code of ['ar', 'zh', 'zh-hant', 'ja', 'ru', 'ko', 'fr', 'de', 'es', 'pt', 'fa', 'th', 'vi', 'sw']) expect(translationLanguage(code).flores, code).toMatch(/^[a-z]{3}_[A-Z][a-z]{3}$/);
    expect(translationLanguage('zh').name).toBe('Chinese (Mandarin, simplified)');
    expect(TRANSLATION_LANGUAGES.every((l) => /^[a-z]{3}_[A-Z][a-z]{3}$/.test(l.flores))).toBe(true);
  });

  it('knows which languages each model translates', () => {
    expect(modelKnows('indictrans2', 'kn')).toBe(true);
    expect(modelKnows('indictrans2', 'ja')).toBe(false);
    for (const code of ['ar', 'zh', 'ja', 'ru', 'ko', 'hi', 'ta']) expect(modelKnows('m2m100-418m', code), code).toBe(true);
    expect(modelKnows('m2m100-418m', 'te')).toBe(false);
    expect(modelKnows('nllb-200-600m', 'te')).toBe(true);
    expect(modelKnows('gemma3:12b', 'sat')).toBe(true);
    expect(modelName('nllb-200-600m')).toBe('NLLB-200 (distilled 600M)');
    expect(modelName('hf:Helsinki-NLP/opus-mt-en-ar')).toBe('Helsinki-NLP/opus-mt-en-ar');
  });

  it('offers only models the setup and the server both know by name', () => {
    const rust = readFileSync(new URL('../../src-tauri/src/indic.rs', import.meta.url), 'utf8');
    const python = readFileSync(new URL('../../scripts/indictrans2-server.py', import.meta.url), 'utf8');
    for (const model of MODEL_CATALOGUE) {
      expect(rust, model.key).toContain(`"${model.key}"`);
      expect(python, model.key).toContain(`"${model.key}":`);
    }
  });

  it('guesses the language from the script', () => {
    expect(detectLanguage('नमस्ते दुनिया')).toBe('hi');
    expect(detectLanguage('ನಮಸ್ಕಾರ ಬೆಂಗಳೂರು')).toBe('kn');
    expect(detectLanguage('வணக்கம்')).toBe('ta');
    expect(detectLanguage('আমার সোনার বাংলা')).toBe('bn');
    expect(detectLanguage('یہ اردو ہے')).toBe('ur');
    expect(detectLanguage('مرحبا بالعالم')).toBe('ar');
    expect(detectLanguage('こんにちは世界')).toBe('ja');
    expect(detectLanguage('你好世界')).toBe('zh');
    expect(detectLanguage('Hello, museum visitors (2026)')).toBe('en');
    expect(detectLanguage('안녕하세요')).toBe('ko');
    expect(detectLanguage('สวัสดี')).toBe('th');
    expect(detectLanguage('Καλημέρα')).toBe('el');
    expect(detectLanguage('שלום')).toBe('he');
    expect(detectLanguage('سلام دوست من چطوری')).toBe('fa');
    expect(detectLanguage('Привет, мир')).toBe('ru');
    expect(detectLanguage('12345 ...')).toBeNull();
  });

  it('cuts long lines into sentences, keeping the spaces between them', () => {
    expect(sentences('One. Two!  Three? Four')).toEqual([
      { text: 'One.', space: ' ' },
      { text: 'Two!', space: '  ' },
      { text: 'Three?', space: ' ' },
      { text: 'Four', space: '' },
    ]);
    expect(sentences('यह पहला वाक्य है। यह दूसरा है।').map((s) => s.text)).toEqual(['यह पहला वाक्य है।', 'यह दूसरा है।']);
    expect(sentences('Version 3.5 is out.').map((s) => s.text)).toEqual(['Version 3.5 is out.']);
  });

  it('keeps blank lines, indentation, list markers and headings, translating only the words', () => {
    const text = '# The steam engine\n\n- It burns coal.\n  2. It turns a wheel.  \n\n> Quote here\n---\n';
    const p = plan(text);
    expect(p.pieces).toEqual(['The steam engine', 'It burns coal.', 'It turns a wheel.', 'Quote here']);
    expect(rebuild(p, upper(p.pieces))).toBe('# THE STEAM ENGINE\n\n- IT BURNS COAL.\n  2. IT TURNS A WHEEL.  \n\n> QUOTE HERE\n---\n');
  });

  it('cuts a long paragraph into sentences and joins the translations', () => {
    const long = `${'The museum opens at nine. '.repeat(12)}Tickets are at the gate.`;
    const p = plan(long, 100);
    expect(p.pieces.length).toBe(13);
    expect(rebuild(p, upper(p.pieces))).toBe(long.toUpperCase());
    // A piece left untranslated keeps its original words.
    expect(rebuild(p, [])).toBe(long);
  });

  it('cuts a sentence too long for the model at spaces', () => {
    const p = plan(`${'word '.repeat(80).trim()}.`, 100);
    expect(p.pieces.every((x) => x.length <= 120)).toBe(true);
    expect(rebuild(p, p.pieces)).toBe(`${'word '.repeat(80).trim()}.`);
  });

  it('translates subtitles and keeps their times', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nWelcome to the museum.\n\n2\n00:00:04,000 --> 00:00:06,000\nThis is a steam engine.\n';
    expect(subtitleFormat(srt)).toBe('srt');
    expect(subtitleFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toBe('vtt');
    expect(subtitleFormat('Just text')).toBeNull();
    const plan = subtitlePlan(srt);
    expect(plan?.pieces).toEqual(['Welcome to the museum.', 'This is a steam engine.']);
    const out = plan?.write(['संग्रहालय में आपका स्वागत है।', 'यह एक भाप इंजन है।']) ?? '';
    expect(out).toContain('00:00:01,000 --> 00:00:03,500');
    expect(out).toContain('संग्रहालय में आपका स्वागत है।');
    expect(out).toContain('00:00:04,000 --> 00:00:06,000');
  });

  it('asks IndicTrans2 with FLORES codes and chat models in words', () => {
    const request = translationRequest('indictrans2', ['Hello'], translationLanguage('en'), translationLanguage('kn'), 'A science museum') as { benchtop: unknown; messages: { content: string }[] };
    expect(request.benchtop).toEqual({ lines: ['Hello'], from: 'eng_Latn', to: 'kan_Knda' });
    expect(request.messages[0]?.content).toContain('from English into Kannada');
    expect(request.messages[0]?.content).toContain('Context: A science museum');
    expect(request.messages[1]?.content).toContain('exactly 1 items');
    const auto = translationRequest('gemma3:12b', ['x'], null, translationLanguage('fr'), '') as { messages: { content: string }[] };
    expect(auto.messages[0]?.content).toContain('from the language it is written in into French');
  });

  it('translates in batches, a piece at a time when a batch comes back the wrong shape, and can stop', async () => {
    const asked: string[][] = [];
    const ask = async (batch: string[]) => {
      asked.push(batch);
      // A model that cannot keep a list of three straight.
      return batch.length === 3 ? null : upper(batch);
    };
    const progress: number[] = [];
    const out = await translatePieces(
      ['a', 'b', 'c', 'd', 'e'],
      ask,
      (done) => progress.push(done),
      () => false,
      3,
    );
    expect(out).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(asked).toEqual([['a', 'b', 'c'], ['a'], ['b'], ['c'], ['d', 'e']]);
    expect(progress).toEqual([3, 5]);
    let calls = 0;
    await expect(
      translatePieces(
        ['a', 'b', 'c', 'd'],
        async (b) => upper(b),
        () => {},
        () => ++calls > 1,
        2,
      ),
    ).rejects.toThrow('Stopped.');
  });
});
