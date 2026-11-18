/** Video toolkit: compress, trim, resize, crop, rotate, speed, GIFs, frames, joining, subtitles and watermarks with FFmpeg. */
import { defineCustomTool } from '../types';
import { BITRATE, DB, END, EXACT, type KitSpec, MediaKit, SPEED, START } from './_media-kit';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv'];

const SPEC: KitSpec = {
  what: 'FFmpeg',
  noun: ['video', 'videos'],
  program: 'ffmpeg',
  extensions: VIDEO_EXTENSIONS,
  probe: true,
  operations: [
    {
      id: 'video-compress',
      label: 'Compress',
      group: 'Size and shape',
      verb: 'Compress',
      description: 'Make videos smaller with H.264, optionally lowering the resolution. Saved as MP4.',
      fields: [
        { key: 'crf', label: 'Quality', type: 'number', min: 18, max: 40, step: 1, value: 28, hint: '18 looks like the original; 28 is a good balance; 35 and above is small and soft' },
        {
          key: 'height',
          label: 'Largest height',
          type: 'select',
          value: '0',
          choices: [
            { value: '0', label: 'Keep the resolution' },
            { value: '1080', label: '1080p' },
            { value: '720', label: '720p' },
            { value: '480', label: '480p' },
            { value: '360', label: '360p' },
          ],
        },
        {
          key: 'preset',
          label: 'Speed',
          type: 'select',
          value: 'medium',
          choices: [
            { value: 'veryfast', label: 'Fast (larger file)' },
            { value: 'medium', label: 'Balanced' },
            { value: 'slow', label: 'Slow (smaller file)' },
          ],
        },
        { ...BITRATE, value: '128' },
      ],
    },
    { id: 'video-trim', label: 'Trim', group: 'Size and shape', verb: 'Trim', description: 'Keep the part between two times.', fields: [START, END, EXACT] },
    {
      id: 'video-resize',
      label: 'Resize',
      group: 'Size and shape',
      verb: 'Resize',
      description: 'Scale to a new width or height; leave one at 0 to keep the proportions.',
      fields: [
        { key: 'width', label: 'Width', type: 'number', min: 0, max: 7680, value: 1280, unit: 'px' },
        { key: 'height', label: 'Height', type: 'number', min: 0, max: 4320, value: 0, unit: 'px' },
      ],
    },
    {
      id: 'video-crop',
      label: 'Crop',
      group: 'Size and shape',
      verb: 'Crop',
      description: 'Cut out a rectangle, measured in pixels from the top-left corner.',
      fields: [
        { key: 'x', label: 'Left', type: 'number', min: 0, max: 16000, value: 0, unit: 'px' },
        { key: 'y', label: 'Top', type: 'number', min: 0, max: 16000, value: 0, unit: 'px' },
        { key: 'w', label: 'Width', type: 'number', min: 2, max: 16000, value: 1280, unit: 'px' },
        { key: 'h', label: 'Height', type: 'number', min: 2, max: 16000, value: 720, unit: 'px' },
      ],
    },
    {
      id: 'video-rotate',
      label: 'Rotate or flip',
      group: 'Size and shape',
      verb: 'Rotate',
      description: 'Turn the picture, or mirror it.',
      fields: [
        {
          key: 'turn',
          label: 'Turn',
          type: 'select',
          value: '90',
          choices: [
            { value: '90', label: '90° clockwise' },
            { value: '270', label: '90° anticlockwise' },
            { value: '180', label: '180°' },
            { value: 'hflip', label: 'Mirror (left to right)' },
            { value: 'vflip', label: 'Upside down (top to bottom)' },
          ],
        },
      ],
    },
    { id: 'video-speed', label: 'Speed up or slow down', group: 'Time', verb: 'Change speed of', description: 'Play faster or slower; the sound keeps its pitch.', fields: [SPEED] },
    {
      id: 'video-fps',
      label: 'Frame rate',
      group: 'Time',
      verb: 'Convert',
      description: 'Change the number of frames per second.',
      fields: [{ key: 'fps', label: 'Frames per second', type: 'number', min: 1, max: 240, value: 30 }],
    },
    {
      id: 'video-merge',
      label: 'Join',
      group: 'Time',
      verb: 'Join',
      combine: true,
      description: 'Join videos end to end, in the order listed. Different sizes are fitted to the first video.',
      fields: [],
    },
    {
      id: 'video-extract-audio',
      label: 'Extract the sound',
      group: 'Sound',
      verb: 'Extract sound from',
      description: 'Save the sound track as an audio file.',
      fields: [
        {
          key: 'to',
          label: 'Format',
          type: 'select',
          value: 'mp3',
          choices: [
            { value: 'mp3', label: 'MP3' },
            { value: 'm4a', label: 'M4A (AAC)' },
            { value: 'wav', label: 'WAV' },
            { value: 'flac', label: 'FLAC (lossless)' },
            { value: 'ogg', label: 'Ogg Vorbis' },
            { value: 'opus', label: 'Opus' },
          ],
        },
        BITRATE,
      ],
    },
    { id: 'video-mute', label: 'Remove the sound', group: 'Sound', verb: 'Mute', description: 'Drop the sound track; the picture is copied without re-encoding.', fields: [] },
    { id: 'video-volume', label: 'Louder or quieter', group: 'Sound', verb: 'Change volume of', description: 'Raise or lower the volume; the picture is copied without re-encoding.', fields: [DB] },
    {
      id: 'video-gif',
      label: 'Make a GIF',
      group: 'Pictures',
      verb: 'Make GIF from',
      description: 'Turn a short clip into an animated GIF with an optimised palette. Trim it first for a small file.',
      fields: [
        { key: 'width', label: 'Width', type: 'number', min: 64, max: 1920, value: 480, unit: 'px' },
        { key: 'fps', label: 'Frames per second', type: 'number', min: 2, max: 30, value: 12 },
      ],
    },
    {
      id: 'video-frame',
      label: 'Save a frame',
      group: 'Pictures',
      verb: 'Save frame from',
      description: 'Save the picture at a given time as a PNG.',
      fields: [{ key: 'at', label: 'Time', type: 'time', value: '0:01', hint: 'Seconds or minutes:seconds' }],
    },
    {
      id: 'video-watermark',
      label: 'Add a logo or watermark',
      group: 'Pictures',
      verb: 'Watermark',
      description: 'Place a picture (PNG with transparency works best) over the video.',
      extra: { label: 'Logo', name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      fields: [
        {
          key: 'position',
          label: 'Position',
          type: 'select',
          value: 'bottom-right',
          choices: [
            { value: 'bottom-right', label: 'Bottom right' },
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'top-right', label: 'Top right' },
            { value: 'top-left', label: 'Top left' },
            { value: 'centre', label: 'Centre' },
          ],
        },
        { key: 'size', label: 'Height', type: 'number', min: 2, max: 80, value: 15, unit: '% of the video' },
        { key: 'opacity', label: 'Opacity', type: 'number', min: 5, max: 100, value: 80, unit: '%' },
        { key: 'margin', label: 'Margin', type: 'number', min: 0, max: 500, value: 24, unit: 'px' },
      ],
    },
    {
      id: 'video-burn-subtitles',
      label: 'Burn in subtitles',
      group: 'Subtitles',
      verb: 'Burn subtitles into',
      description: 'Draw subtitles onto the picture so they always show. Make them with Transcription and Subtitles.',
      extra: { label: 'Subtitles', name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
      fields: [{ key: 'size', label: 'Text size', type: 'number', min: 8, max: 96, value: 24, hint: 'Ignored for .ass files, which carry their own styles' }],
    },
    {
      id: 'video-add-subtitles',
      label: 'Add a subtitle track',
      group: 'Subtitles',
      verb: 'Add subtitles to',
      description: 'Add subtitles as a track viewers can switch on and off. Nothing is re-encoded.',
      extra: { label: 'Subtitles', name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
      fields: [
        {
          key: 'to',
          label: 'Container',
          type: 'select',
          value: 'mp4',
          choices: [
            { value: 'mp4', label: 'MP4' },
            { value: 'mkv', label: 'MKV' },
          ],
        },
      ],
    },
  ],
};

export default defineCustomTool(({ toolId }) => <MediaKit toolId={toolId} spec={SPEC} />);
