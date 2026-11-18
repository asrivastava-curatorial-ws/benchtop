/** Audio toolkit: convert, trim, loudness, volume, fades, silence, noise, speed, joining and pictures of sound with FFmpeg. */
import { defineCustomTool } from '../types';
import { AUDIO_TO, BITRATE, DB, END, EXACT, type KitSpec, MediaKit, SPEED, START } from './_media-kit';

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka', 'webm', 'mp4', 'mkv', 'mov'];

const SPEC: KitSpec = {
  what: 'FFmpeg',
  noun: ['audio', 'files'],
  program: 'ffmpeg',
  extensions: AUDIO_EXTENSIONS,
  probe: true,
  operations: [
    {
      id: 'audio-convert',
      label: 'Convert',
      group: 'Format',
      verb: 'Convert',
      description: 'Change the format, quality, sample rate or channels. Video files give their sound track.',
      fields: [
        AUDIO_TO,
        BITRATE,
        {
          key: 'rate',
          label: 'Sample rate',
          type: 'select',
          value: '0',
          choices: [
            { value: '0', label: 'Keep' },
            { value: '16000', label: '16 kHz (speech)' },
            { value: '22050', label: '22.05 kHz' },
            { value: '44100', label: '44.1 kHz (CD)' },
            { value: '48000', label: '48 kHz (video)' },
          ],
        },
        {
          key: 'channels',
          label: 'Channels',
          type: 'select',
          value: 'keep',
          choices: [
            { value: 'keep', label: 'Keep' },
            { value: 'mono', label: 'Mono' },
            { value: 'stereo', label: 'Stereo' },
          ],
        },
      ],
    },
    { id: 'audio-trim', label: 'Trim', group: 'Edit', verb: 'Trim', description: 'Keep the part between two times.', fields: [START, END, EXACT] },
    { id: 'audio-merge', label: 'Join', group: 'Edit', verb: 'Join', combine: true, description: 'Join files end to end, in the order listed.', fields: [AUDIO_TO] },
    { id: 'audio-speed', label: 'Speed up or slow down', group: 'Edit', verb: 'Change speed of', description: 'Play faster or slower without changing the pitch.', fields: [SPEED] },
    {
      id: 'audio-fade',
      label: 'Fade in and out',
      group: 'Edit',
      verb: 'Fade',
      description: 'Fade in at the start and out at the end; 0 skips a fade.',
      fields: [
        { key: 'in', label: 'Fade in', type: 'number', min: 0, max: 600, step: 0.5, value: 2, unit: 's' },
        { key: 'out', label: 'Fade out', type: 'number', min: 0, max: 600, step: 0.5, value: 3, unit: 's' },
      ],
    },
    {
      id: 'audio-normalize',
      label: 'Even out loudness',
      group: 'Level',
      verb: 'Normalise',
      description: 'Bring the loudness to a standard level (EBU R128 loudnorm) so files play at the same volume.',
      fields: [
        {
          key: 'lufs',
          label: 'Target',
          type: 'select',
          value: '-16',
          choices: [
            { value: '-14', label: '−14 LUFS (music streaming)' },
            { value: '-16', label: '−16 LUFS (podcasts, speech)' },
            { value: '-23', label: '−23 LUFS (broadcast, EBU R128)' },
          ],
        },
      ],
    },
    { id: 'audio-volume', label: 'Louder or quieter', group: 'Level', verb: 'Change volume of', description: 'Raise or lower the volume by a fixed amount.', fields: [DB] },
    {
      id: 'audio-silence',
      label: 'Remove silence',
      group: 'Clean up',
      verb: 'Remove silence from',
      description: 'Cut pauses longer than the given gap.',
      fields: [
        { key: 'threshold', label: 'Silence below', type: 'number', min: -90, max: -10, value: -45, unit: 'dB' },
        { key: 'gap', label: 'Longest pause kept', type: 'number', min: 0.05, max: 10, step: 0.05, value: 0.5, unit: 's' },
      ],
    },
    {
      id: 'audio-denoise',
      label: 'Reduce background noise',
      group: 'Clean up',
      verb: 'Clean',
      description: 'Lower steady hiss and hum (FFT noise reduction). Strong settings can make voices sound watery.',
      fields: [{ key: 'strength', label: 'Strength', type: 'number', min: 1, max: 40, value: 12, unit: 'dB' }],
    },
    {
      id: 'audio-waveform',
      label: 'Waveform picture',
      group: 'Pictures',
      verb: 'Draw waveform of',
      description: 'Save a PNG of the waveform, for thumbnails and show notes.',
      fields: [{ key: 'colour', label: 'Colour', type: 'colour', value: '#53c9a0' }],
    },
    { id: 'audio-spectrogram', label: 'Spectrogram picture', group: 'Pictures', verb: 'Draw spectrogram of', description: 'Save a PNG of the frequencies over time, with a scale.', fields: [] },
  ],
};

export default defineCustomTool(({ toolId }) => <MediaKit toolId={toolId} spec={SPEC} />);
