import { htmlToJsx } from '../../lib/html-to-jsx';
import { defineTextTool, type Values } from '../types';

const SAMPLE = `<div class="gallery-card" style="border-left: 4px solid #17694e; padding: 12px">
  <!-- One card per gallery -->
  <h3>Engine Hall</h3>
  <p>Steam, diesel and electric locomotives from 1890 onwards. Entry: <strong>&#8377;50</strong>&nbsp;per person.</p>
  <label for="visit-date">Visit on</label> <input id="visit-date" type="date" value="2026-12-10">
  <select name="slot"><option>10:00</option><option selected>14:00</option></select>
  <button type="button" onclick="book('engine-hall')">Book a guided tour</button>
  <svg viewBox="0 0 24 24" width="24" height="24"><path stroke-width="2" stroke-linecap="round" d="M4 12h16"/></svg>
</div>`;

export default defineTextTool({
  input: { label: 'HTML', language: 'html', sample: SAMPLE },
  output: { label: 'JSX', language: 'jsx' },
  options: [
    { key: 'component', label: 'Wrap in a component', type: 'toggle', default: false },
    { key: 'name', label: 'Component name', type: 'text', default: 'GalleryCard', mono: true, showIf: (v: Values) => v.component === true },
    {
      key: 'uncontrolled',
      label: 'Form fields keep their own state',
      type: 'toggle',
      default: true,
      help: 'value, checked and selected become defaultValue and defaultChecked, so React does not make the fields read-only.',
    },
    {
      key: 'indent',
      label: 'Indent',
      type: 'segmented',
      choices: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
      ],
      default: '2',
    },
  ],
  run(input, o) {
    if (input.trim() === '') return '';
    const name = o.name.trim() || 'Component';
    const { code, warnings } = htmlToJsx(input, { component: o.component ? name : undefined, uncontrolled: o.uncontrolled, indent: Number(o.indent) });
    return { output: code, language: 'jsx', filename: o.component ? `${name.replace(/[^A-Za-z0-9_$]+/g, '')}.jsx` : 'markup.jsx', warnings: warnings.length > 0 ? warnings : undefined };
  },
});
