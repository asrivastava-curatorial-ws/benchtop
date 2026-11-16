import { isDesktop } from '../../platform';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'As text' },
  options: [],
  mainThread: true,
  action: 'Refresh',
  runOnEmpty: true,
  run() {
    const screen = window.screen;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number } };
    const media = (query: string) => window.matchMedia(query).matches;
    const fields: Field[] = [
      { label: 'Screen', value: '' },
      { label: 'Screen size', value: `${screen.width} × ${screen.height} px (logical)` },
      { label: 'Pixel ratio', value: `${window.devicePixelRatio}× → ${Math.round(screen.width * window.devicePixelRatio)} × ${Math.round(screen.height * window.devicePixelRatio)} physical px` },
      { label: 'Available area', value: `${screen.availWidth} × ${screen.availHeight} px` },
      { label: 'Window', value: `${window.innerWidth} × ${window.innerHeight} px` },
      { label: 'Colour depth', value: `${screen.colorDepth} bits${media('(color-gamut: p3)') ? ', wide gamut (P3)' : ''}${media('(dynamic-range: high)') ? ', HDR' : ''}` },
      { label: 'Orientation', value: screen.orientation?.type ?? '—' },
      { label: 'Preferences', value: '' },
      { label: 'Colour scheme', value: media('(prefers-color-scheme: dark)') ? 'Dark' : 'Light' },
      { label: 'Reduced motion', value: media('(prefers-reduced-motion: reduce)') ? 'Yes' : 'No' },
      { label: 'Languages', value: navigator.languages.join(', ') },
      {
        label: 'Time zone',
        value: `${Intl.DateTimeFormat().resolvedOptions().timeZone} (UTC${-new Date().getTimezoneOffset() >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(new Date().getTimezoneOffset()) / 60)).padStart(2, '0')}:${String(Math.abs(new Date().getTimezoneOffset()) % 60).padStart(2, '0')})`,
      },
      { label: 'Number format', value: (1234567.891).toLocaleString() },
      { label: 'Hardware', value: '' },
      { label: 'CPU threads', value: String(navigator.hardwareConcurrency ?? '—') },
      { label: 'Memory', value: nav.deviceMemory ? `at least ${nav.deviceMemory} GB` : 'Not reported' },
      { label: 'Touch points', value: String(navigator.maxTouchPoints) },
      { label: 'Pointer', value: media('(pointer: fine)') ? 'Precise (mouse or pen)' : media('(pointer: coarse)') ? 'Touch' : 'None' },
      { label: 'Software', value: '' },
      { label: 'Platform', value: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform },
      { label: 'Running in', value: isDesktop ? 'Benchtop desktop app' : 'A web browser' },
      { label: 'User agent', value: navigator.userAgent, mono: true },
      { label: 'Cookies enabled', value: navigator.cookieEnabled ? 'Yes' : 'No' },
      { label: 'Online', value: navigator.onLine ? 'Yes' : 'No' },
    ];
    return {
      fields,
      output: fields
        .filter((field) => field.value !== '')
        .map((field) => `${field.label}: ${field.value}`)
        .join('\n'),
      filename: 'device-info.txt',
    };
  },
});
