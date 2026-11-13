import { formatBytes } from '../../lib/bytes';
import { formatDuration, textStats } from '../../lib/words';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: {
    label: 'Text',
    sample: 'Visvesvaraya Industrial and Technological Museum opened in 1962.\n\nIts galleries cover engines, electricity, space and science for children. Visitors can try most exhibits themselves!',
  },
  output: { label: 'Most frequent words' },
  options: [{ key: 'top', label: 'Words to list', type: 'number', min: 0, max: 100, step: 1, default: 10 }],
  run(input, o) {
    const stats = textStats(input, o.top);
    return {
      output: stats.topWords.map(([word, count]) => `${String(count).padStart(5)}  ${word}`).join('\n'),
      fields: [
        { label: 'Words', value: stats.words.toLocaleString('en-US') },
        { label: 'Characters', value: stats.characters.toLocaleString('en-US') },
        { label: 'Without spaces', value: stats.charactersNoSpaces.toLocaleString('en-US') },
        { label: 'Sentences', value: stats.sentences.toLocaleString('en-US') },
        { label: 'Paragraphs', value: stats.paragraphs.toLocaleString('en-US') },
        { label: 'Lines', value: stats.lines.toLocaleString('en-US') },
        { label: 'Size (UTF-8)', value: formatBytes(stats.bytes) },
        { label: 'Reading time', value: formatDuration(stats.readingMinutes) },
        { label: 'Speaking time', value: formatDuration(stats.speakingMinutes) },
      ],
    };
  },
});
