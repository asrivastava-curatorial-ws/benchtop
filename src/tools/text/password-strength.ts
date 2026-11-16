import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

let checker: Promise<(password: string) => import('@zxcvbn-ts/core').ZxcvbnResult> | null = null;

async function load() {
  checker ??= (async () => {
    const [{ ZxcvbnFactory }, common, english] = await Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common'), import('@zxcvbn-ts/language-en')]);
    const factory = new ZxcvbnFactory({ dictionary: { ...common.dictionary, ...english.dictionary }, graphs: common.adjacencyGraphs, translations: english.translations });
    return (password: string) => factory.check(password);
  })();
  return checker;
}

const SCORES = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const TONES: Field['tone'][] = ['bad', 'bad', 'warn', 'ok', 'ok'];

export default defineTextTool({
  input: false,
  output: false,
  options: [{ key: 'password', label: 'Password', type: 'text', default: '', secret: true, wide: true, help: 'Checked on this computer only; it is never stored or sent anywhere.' }],
  runOnEmpty: true,
  async run(_input, o) {
    if (o.password === '') return {};
    if (o.password.length > 256) throw new ToolError('Check passwords of up to 256 characters.');
    const result = (await load())(o.password);
    const fields: Field[] = [
      { label: 'Strength', value: `${SCORES[result.score]} (${result.score} of 4)`, tone: TONES[result.score] },
      { label: 'Guesses needed', value: `about 10^${result.guessesLog10.toFixed(1)}` },
      { label: 'Online attack, throttled (100/hour)', value: String(result.crackTimes.onlineThrottlingXPerHour.display) },
      { label: 'Online attack (10/second)', value: String(result.crackTimes.onlineNoThrottlingXPerSecond.display) },
      { label: 'Offline, slow hash (10 000/second)', value: String(result.crackTimes.offlineSlowHashingXPerSecond.display) },
      { label: 'Offline, fast hash (10 billion/second)', value: String(result.crackTimes.offlineFastHashingXPerSecond.display), tone: result.score < 3 ? 'bad' : undefined },
      { label: 'Length', value: `${[...o.password].length} characters` },
    ];
    if (result.feedback.warning) fields.push({ label: 'Problem', value: result.feedback.warning, tone: 'warn' });
    for (const suggestion of result.feedback.suggestions) fields.push({ label: 'Suggestion', value: suggestion, tone: 'muted' });
    const patterns = result.sequence.map((match) => `${match.token} (${match.pattern})`).join(', ');
    if (patterns) fields.push({ label: 'Found patterns', value: patterns, mono: true });
    return { fields, info: 'Estimates by zxcvbn-ts, which recognises common passwords, names, dates, keyboard patterns and substitutions.' };
  },
});
