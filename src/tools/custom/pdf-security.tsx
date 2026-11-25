/** PDF passwords, compression, repair and colour with qpdf and Ghostscript, installed on this computer. */
import { defineCustomTool } from '../types';
import { type KitSpec, MediaKit } from './_media-kit';

const SPEC: KitSpec = {
  what: 'qpdf and Ghostscript',
  noun: ['PDF', 'PDFs'],
  program: 'qpdf',
  anyOf: ['qpdf', 'ghostscript'],
  extensions: ['pdf'],
  operations: [
    {
      id: 'pdf-protect',
      label: 'Add a password',
      group: 'Passwords',
      verb: 'Protect',
      program: 'qpdf',
      description: 'Encrypt with AES-256 so the PDF needs a password to open, and optionally stop printing, copying or editing.',
      fields: [
        { key: 'password', label: 'Password to open', type: 'password', value: '' },
        { key: 'ownerPassword', label: 'Password to change permissions', type: 'password', value: '', hint: 'Leave empty to use the same password' },
        { key: 'noPrint', label: 'Do not allow printing', type: 'toggle', value: false },
        { key: 'noCopy', label: 'Do not allow copying text and pictures', type: 'toggle', value: false },
        { key: 'noEdit', label: 'Do not allow changes', type: 'toggle', value: false },
      ],
    },
    {
      id: 'pdf-unlock',
      label: 'Remove a password',
      group: 'Passwords',
      verb: 'Unlock',
      program: 'qpdf',
      description: 'Save a copy without encryption. You need the password, unless the PDF only restricts printing or copying.',
      fields: [{ key: 'password', label: 'Password', type: 'password', value: '', hint: 'Leave empty for PDFs that open without one' }],
    },
    {
      id: 'pdf-optimise',
      label: 'Optimise (lossless)',
      group: 'Size',
      verb: 'Optimise',
      program: 'qpdf',
      description: 'Recompress and pack the PDF without changing how anything looks. Saves most on PDFs from older software.',
      fields: [{ key: 'linearize', label: 'Fast web view (linearise)', type: 'toggle', value: false, hint: 'Lets browsers show the first page before the whole file arrives' }],
    },
    {
      id: 'pdf-compress',
      label: 'Compress pictures',
      group: 'Size',
      verb: 'Compress',
      program: 'ghostscript',
      description: 'Rewrite the PDF with Ghostscript, reducing picture resolution. Text stays sharp; scans shrink the most.',
      fields: [
        {
          key: 'quality',
          label: 'Picture quality',
          type: 'select',
          value: 'ebook',
          choices: [
            { value: 'screen', label: 'Screen (72 dpi, smallest)' },
            { value: 'ebook', label: 'E-book (150 dpi, balanced)' },
            { value: 'printer', label: 'Print (300 dpi)' },
            { value: 'prepress', label: 'Prepress (300 dpi, keeps colour profiles)' },
          ],
        },
      ],
    },
    {
      id: 'pdf-repair',
      label: 'Repair',
      group: 'Repair and colour',
      verb: 'Repair',
      program: 'qpdf',
      description: 'Rebuild a damaged or truncated PDF that will not open, or opens with errors: qpdf reconstructs its index of objects and writes a clean copy.',
      fields: [],
    },
    {
      id: 'pdf-grayscale',
      label: 'Shades of grey (text stays text)',
      group: 'Repair and colour',
      verb: 'Convert',
      program: 'ghostscript',
      description: 'Turn every colour into grey with Ghostscript, keeping text, lines and pictures as they are (unlike redrawing the pages), ready for black-only printing.',
      fields: [],
    },
    {
      id: 'pdf-remove-images',
      label: 'Remove all pictures',
      group: 'Repair and colour',
      verb: 'Remove',
      program: 'ghostscript',
      description: 'Take every picture out with Ghostscript, leaving the text and drawings: for printing drafts or making a light text-only copy.',
      fields: [],
    },
  ],
};

export default defineCustomTool(({ toolId }) => <MediaKit toolId={toolId} spec={SPEC} />);
