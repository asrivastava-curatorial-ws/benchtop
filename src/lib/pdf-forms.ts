/**
 * Filling PDF forms: the fields of interactive (AcroForm) forms, and free text,
 * ticks and dates placed anywhere on flat forms (scans and printed-style PDFs).
 * Values in Hindi or with ₹ are drawn with Benchtop Sans, shaped by HarfBuzz,
 * so they look right in every reader.
 */
import {
  beginMarkedContent,
  clip,
  endMarkedContent,
  endPath,
  PDFCheckBox,
  type PDFDocument,
  PDFDropdown,
  type PDFField,
  type PDFFont,
  PDFName,
  type PDFOperator,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFWidgetAnnotation,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingColor,
  TextAlignment,
} from 'pdf-lib';
import { ToolError } from './errors';
import { hexColour, loadPdf, viewToPage } from './pdf-edit';
import { actualText, drawText, finishFonts, fontsFor, textOperators, textWidth } from './pdf-text';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button';

export interface FormField {
  readonly name: string;
  readonly kind: FieldKind;
  readonly value: string | boolean | readonly string[];
  readonly options: readonly string[];
  readonly multiline: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly maxLength?: number;
  /** 1-based page of the first widget, when known. */
  readonly page?: number;
}

export interface FormInfo {
  readonly fields: readonly FormField[];
  /** A dynamic (XFA) form: readers other than Adobe's show only its AcroForm copy, if any. */
  readonly xfa: boolean;
}

function kindOf(field: PDFField): FieldKind {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  if (field instanceof PDFSignature) return 'signature';
  return 'button';
}

function pageOf(doc: PDFDocument, field: PDFField): number | undefined {
  const widget = field.acroField.getWidgets()[0];
  const ref = widget?.P();
  if (ref) {
    const index = doc.getPages().findIndex((page) => page.ref === ref);
    if (index >= 0) return index + 1;
  }
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i]?.node.Annots();
    if (!annots) continue;
    for (let j = 0; j < annots.size(); j++) if (widget && annots.lookup(j) === widget.dict) return i + 1;
  }
  return undefined;
}

export function readForm(doc: PDFDocument): FormInfo {
  const form = doc.getForm();
  const fields = form.getFields().map((field): FormField => {
    const kind = kindOf(field);
    let value: FormField['value'] = '';
    let options: string[] = [];
    let multiline = false;
    let maxLength: number | undefined;
    if (field instanceof PDFTextField) {
      value = field.getText() ?? '';
      multiline = field.isMultiline();
      maxLength = field.getMaxLength();
    } else if (field instanceof PDFCheckBox) value = field.isChecked();
    else if (field instanceof PDFRadioGroup) {
      options = field.getOptions();
      value = field.getSelected() ?? '';
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      options = field.getOptions();
      value = field.getSelected();
    }
    return { name: field.getName(), kind, value, options, multiline, readOnly: field.isReadOnly(), required: field.isRequired(), maxLength, page: pageOf(doc, field) };
  });
  return { fields, xfa: form.hasXFA() };
}

/** Lines of `text` that fit `width` at `size` (words wrap; long words break). */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line && textWidth(font, next.trimEnd(), size) > width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** A text field's appearance drawn with shaped text (pdf-lib's own cannot shape Devanagari). */
function shapedTextAppearance(field: PDFTextField | PDFDropdown, widget: PDFWidgetAnnotation, font: PDFFont): PDFOperator[] {
  const rect = widget.getRectangle();
  const border = widget.getBorderStyle()?.getWidth() ?? 0;
  const pad = border + 2;
  const width = rect.width - 2 * pad;
  const height = rect.height - 2 * pad;
  const text = field instanceof PDFTextField ? (field.getText() ?? '') : (field.getSelected()[0] ?? '');
  const multiline = field instanceof PDFTextField && field.isMultiline();
  let size = multiline ? 11 : Math.min(12, height * 0.72);
  if (!multiline) while (size > 4 && textWidth(font, text, size) > width) size -= 0.5;
  const lines = multiline ? wrap(font, text, size, width) : [text];
  const alignment = field instanceof PDFTextField ? field.getAlignment() : TextAlignment.Left;
  const ops: PDFOperator[] = [beginMarkedContent('Tx'), pushGraphicsState(), rectangle(pad - 1, pad - 1, width + 2, height + 2), clip(), endPath(), setFillingColor(rgb(0, 0, 0))];
  const lineHeight = size * 1.2;
  lines.forEach((line, i) => {
    const w = textWidth(font, line, size);
    const x = alignment === TextAlignment.Center ? pad + (width - w) / 2 : alignment === TextAlignment.Right ? pad + width - w : pad;
    const y = multiline ? rect.height - pad - lineHeight * (i + 1) + size * 0.25 : (rect.height - size * 0.72) / 2;
    ops.push(...actualText(font, line, textOperators(font, PDFName.of(font.name), line, { x, y, size })));
  });
  ops.push(popGraphicsState(), endMarkedContent());
  return ops;
}

/** Text placed anywhere on a page (for flat forms). */
export interface Placed {
  /** 1-based. */
  readonly page: number;
  /** Baseline start, in points from the bottom-left of the page as shown. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly colour: string;
}

export interface FillOptions {
  readonly values: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly placed?: readonly Placed[];
  /** Turn fields into plain page content so nobody can change them. */
  readonly flatten?: boolean;
}

export async function fillPdf(input: Uint8Array, options: FillOptions): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  // Only touch the form when there is one: getForm() would add an empty one to flat PDFs.
  const hasForm = doc.catalog.has(PDFName.of('AcroForm'));
  const form = doc.getForm();
  const texts: string[] = [...(options.placed ?? []).map((p) => p.text)];
  for (const [name, value] of hasForm ? Object.entries(options.values) : []) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    if (field instanceof PDFTextField && typeof value === 'string') {
      const max = field.getMaxLength();
      if (max !== undefined && [...value].length > max) throw new ToolError(`"${name}" takes at most ${max} characters.`);
      field.setText(value || undefined);
      texts.push(value);
    } else if (field instanceof PDFCheckBox) {
      if (value === true) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup && typeof value === 'string' && value) field.select(value);
    else if (field instanceof PDFDropdown) {
      const chosen = typeof value === 'string' ? (value ? [value] : []) : [...(value as string[])];
      if (chosen.length) field.select(chosen[0] as string);
      else field.clear();
      texts.push(...chosen);
    } else if (field instanceof PDFOptionList) {
      const chosen = typeof value === 'string' ? (value ? [value] : []) : [...(value as string[])];
      if (chosen.length) field.select(chosen);
      else field.clear();
      texts.push(...chosen);
    }
  }
  const fonts = await fontsFor(doc, texts);
  if (fonts.unicode && hasForm) {
    for (const field of form.getFields()) {
      if (field instanceof PDFTextField) field.updateAppearances(fonts.regular, (f, w, font) => shapedTextAppearance(f, w, font));
      else if (field instanceof PDFDropdown) field.updateAppearances(fonts.regular, (f, w, font) => shapedTextAppearance(f, w, font));
    }
  }
  if (hasForm && form.getFields().length) form.updateFieldAppearances(fonts.unicode ? undefined : fonts.regular);
  if (!hasForm) doc.catalog.delete(PDFName.of('AcroForm'));
  for (const item of options.placed ?? []) {
    if (!item.text.trim()) continue;
    const page = doc.getPage(item.page - 1);
    const view = viewToPage(page);
    item.text.split(/\r\n|\r|\n/).forEach((line, i) => {
      const [x, y] = view.map(item.x, item.y - i * item.size * 1.2);
      drawText(page, fonts.regular, line, { x, y, size: item.size, color: hexColour(item.colour), angle: view.turn });
    });
  }
  if (options.flatten && hasForm) form.flatten({ updateFieldAppearances: false });
  doc.setModificationDate(new Date());
  await finishFonts(doc);
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

/** Removes the XFA copy of a form so every reader shows (and this tool fills) the AcroForm fields. */
export async function dropXfa(input: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdf(input);
  doc.getForm().deleteXFA();
  return doc.save({ useObjectStreams: true });
}
