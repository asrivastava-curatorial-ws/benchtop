/**
 * PDF operations on the document structure, with pdf-lib: bookmarks,
 * attachments, overlays, annotations, signatures, sanitising, flattening,
 * form fields, JavaScript, a report of everything in a file, an
 * accessibility check, page size and stacking, blank pages, stamps, and the
 * space for an RFC 3161 document timestamp.  Pages count from 1 where the
 * user sees them.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  type PDFDocument,
  PDFDropdown,
  type PDFField,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFString,
  PDFTextField,
} from 'pdf-lib';
import { ToolError } from './errors';

/* ---------------------------------------------------------------- basics -- */

const N = (name: string) => PDFName.of(name);

/** Follows a reference. */
function deref(doc: PDFDocument, object: PDFObject | undefined): PDFObject | undefined {
  return object instanceof PDFRef ? doc.context.lookup(object) : object;
}

function dictOf(doc: PDFDocument, object: PDFObject | undefined): PDFDict | undefined {
  const o = deref(doc, object);
  if (o instanceof PDFDict) return o;
  if (o instanceof PDFStream) return o.dict;
  return undefined;
}

function arrayOf(doc: PDFDocument, object: PDFObject | undefined): PDFArray | undefined {
  const o = deref(doc, object);
  return o instanceof PDFArray ? o : undefined;
}

/** A PDF text string as text. */
export function textOf(doc: PDFDocument, object: PDFObject | undefined): string {
  const o = deref(doc, object);
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  if (o instanceof PDFNumber) return String(o.asNumber());
  return '';
}

const nameOf = (doc: PDFDocument, dict: PDFDict | undefined, key: string): string => {
  const o = deref(doc, dict?.get(N(key)));
  return o instanceof PDFName ? o.decodeText() : '';
};

const numberOf = (doc: PDFDocument, object: PDFObject | undefined): number | undefined => {
  const o = deref(doc, object);
  return o instanceof PDFNumber ? o.asNumber() : undefined;
};

/** The bytes of a stream, decoded. */
export function streamBytes(stream: PDFObject | undefined): Uint8Array {
  if (stream instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(stream).decode();
    } catch {
      return stream.contents;
    }
  }
  if (stream instanceof PDFStream) return stream.getContents();
  return new Uint8Array();
}

/** Every key/value pair in a name tree (Names arrays under Kids). */
function nameTree(doc: PDFDocument, root: PDFDict | undefined, seen = new Set<PDFDict>()): [string, PDFObject][] {
  if (!root || seen.has(root)) return [];
  seen.add(root);
  const out: [string, PDFObject][] = [];
  const names = arrayOf(doc, root.get(N('Names')));
  if (names)
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const value = names.get(i + 1);
      if (value) out.push([textOf(doc, names.get(i)), value]);
    }
  const kids = arrayOf(doc, root.get(N('Kids')));
  if (kids) for (let i = 0; i < kids.size(); i++) out.push(...nameTree(doc, dictOf(doc, kids.get(i)), seen));
  return out;
}

const pageIndex = (doc: PDFDocument) => {
  const map = new Map<string, number>();
  doc.getPages().forEach((p, i) => {
    map.set(p.ref.toString(), i + 1);
  });
  return map;
};

/* -------------------------------------------------------------- outline -- */

export interface OutlineItem {
  readonly title: string;
  /** Page it goes to (from 1), or 0 when it goes nowhere this tool understands. */
  readonly page: number;
  readonly children: readonly OutlineItem[];
}

/** Where a destination (array, name or GoTo action) points, as a page number. */
function destinationPage(doc: PDFDocument, dest: PDFObject | undefined, pages: Map<string, number>, named: Map<string, PDFObject>): number {
  let d = deref(doc, dest);
  if (d instanceof PDFString || d instanceof PDFHexString || d instanceof PDFName) d = deref(doc, named.get(d instanceof PDFName ? d.decodeText() : d.decodeText()));
  if (d instanceof PDFDict) d = deref(doc, d.get(N('D')));
  if (d instanceof PDFArray) {
    const first = d.get(0);
    if (first instanceof PDFRef) return pages.get(first.toString()) ?? 0;
    if (first instanceof PDFNumber) return first.asNumber() + 1;
  }
  return 0;
}

function namedDestinations(doc: PDFDocument): Map<string, PDFObject> {
  const map = new Map<string, PDFObject>();
  const names = dictOf(doc, doc.catalog.get(N('Names')));
  for (const [k, v] of nameTree(doc, dictOf(doc, names?.get(N('Dests'))))) map.set(k, v);
  const old = dictOf(doc, doc.catalog.get(N('Dests')));
  if (old) for (const [k, v] of old.entries()) map.set(k.decodeText(), v);
  return map;
}

export function readOutline(doc: PDFDocument): OutlineItem[] {
  const outlines = dictOf(doc, doc.catalog.get(N('Outlines')));
  if (!outlines) return [];
  const pages = pageIndex(doc);
  const named = namedDestinations(doc);
  const seen = new Set<PDFDict>();
  const walk = (first: PDFObject | undefined, depth: number): OutlineItem[] => {
    const out: OutlineItem[] = [];
    let node = dictOf(doc, first);
    while (node && !seen.has(node) && depth < 50) {
      seen.add(node);
      const action = dictOf(doc, node.get(N('A')));
      const page = node.has(N('Dest'))
        ? destinationPage(doc, node.get(N('Dest')), pages, named)
        : action && nameOf(doc, action, 'S') === 'GoTo'
          ? destinationPage(doc, action.get(N('D')), pages, named)
          : 0;
      out.push({ title: textOf(doc, node.get(N('Title'))), page, children: walk(node.get(N('First')), depth + 1) });
      node = dictOf(doc, node.get(N('Next')));
    }
    return out;
  };
  return walk(outlines.get(N('First')), 0);
}

/** Replaces the bookmarks with these (an empty list removes them). */
export function writeOutline(doc: PDFDocument, items: readonly OutlineItem[], openPanel = true): void {
  const catalog = doc.catalog;
  if (!items.length) {
    catalog.delete(N('Outlines'));
    if (nameOf(doc, catalog, 'PageMode') === 'UseOutlines') catalog.delete(N('PageMode'));
    return;
  }
  const pages = doc.getPages();
  const context = doc.context;
  const rootRef = context.nextRef();
  const build = (list: readonly OutlineItem[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = list.map(() => context.nextRef());
    let count = 0;
    list.forEach((item, i) => {
      const ref = refs[i] as PDFRef;
      const page = pages[Math.min(pages.length, Math.max(1, item.page)) - 1];
      const dict = context.obj({ Title: PDFHexString.fromText(item.title || 'Untitled'), Parent: parent }) as PDFDict;
      if (page) dict.set(N('Dest'), context.obj([page.ref, N('XYZ'), null, null, null]));
      if (i > 0) dict.set(N('Prev'), refs[i - 1] as PDFRef);
      if (i < list.length - 1) dict.set(N('Next'), refs[i + 1] as PDFRef);
      count += 1;
      if (item.children.length) {
        const kids = build(item.children, ref);
        dict.set(N('First'), kids.first);
        dict.set(N('Last'), kids.last);
        dict.set(N('Count'), PDFNumber.of(kids.count));
        count += kids.count;
      }
      context.assign(ref, dict);
    });
    return { first: refs[0] as PDFRef, last: refs[refs.length - 1] as PDFRef, count };
  };
  const top = build(items, rootRef);
  context.assign(rootRef, context.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  catalog.set(N('Outlines'), rootRef);
  if (openPanel) catalog.set(N('PageMode'), N('UseOutlines'));
}

/* ----------------------------------------------------------- attachments -- */

export interface Attachment {
  readonly name: string;
  readonly description: string;
  readonly size: number;
  readonly bytes: Uint8Array;
  /** Where it lives: the document's list of files, or an annotation on a page. */
  readonly where: 'document' | number;
}

function fileOf(doc: PDFDocument, spec: PDFDict | undefined): Uint8Array {
  const ef = dictOf(doc, spec?.get(N('EF')));
  const stream = deref(doc, ef?.get(N('UF')) ?? ef?.get(N('F')));
  return streamBytes(stream);
}

export function listAttachments(doc: PDFDocument): Attachment[] {
  const out: Attachment[] = [];
  const names = dictOf(doc, doc.catalog.get(N('Names')));
  for (const [key, value] of nameTree(doc, dictOf(doc, names?.get(N('EmbeddedFiles'))))) {
    const spec = dictOf(doc, value);
    const bytes = fileOf(doc, spec);
    out.push({ name: textOf(doc, spec?.get(N('UF'))) || textOf(doc, spec?.get(N('F'))) || key, description: textOf(doc, spec?.get(N('Desc'))), size: bytes.length, bytes, where: 'document' });
  }
  doc.getPages().forEach((page, i) => {
    const annots = arrayOf(doc, page.node.get(N('Annots')));
    for (let k = 0; annots && k < annots.size(); k++) {
      const a = dictOf(doc, annots.get(k));
      if (nameOf(doc, a, 'Subtype') !== 'FileAttachment') continue;
      const spec = dictOf(doc, a?.get(N('FS')));
      const bytes = fileOf(doc, spec);
      out.push({
        name: textOf(doc, spec?.get(N('UF'))) || textOf(doc, spec?.get(N('F'))) || `attachment-${i + 1}-${k + 1}`,
        description: textOf(doc, a?.get(N('Contents'))),
        size: bytes.length,
        bytes,
        where: i + 1,
      });
    }
  });
  return out;
}

/** Removes the named document attachments (all of them when `names` is empty), and file-attachment annotations when asked. */
export function removeAttachments(doc: PDFDocument, names: readonly string[], annotationsToo = false): void {
  const tree = dictOf(doc, dictOf(doc, doc.catalog.get(N('Names')))?.get(N('EmbeddedFiles')));
  if (tree) {
    const keep = nameTree(doc, tree).filter(([key, value]) => {
      const spec = dictOf(doc, value);
      const name = textOf(doc, spec?.get(N('UF'))) || textOf(doc, spec?.get(N('F'))) || key;
      return names.length > 0 && !names.includes(name) && !names.includes(key);
    });
    const namesDict = dictOf(doc, doc.catalog.get(N('Names')));
    if (keep.length) {
      const flat: PDFObject[] = [];
      for (const [k, v] of keep.sort((x, y) => (x[0] < y[0] ? -1 : 1))) flat.push(PDFHexString.fromText(k), v);
      namesDict?.set(N('EmbeddedFiles'), doc.context.obj({ Names: flat }));
    } else namesDict?.delete(N('EmbeddedFiles'));
  }
  if (annotationsToo) removeAnnotations(doc, (subtype) => subtype === 'FileAttachment');
}

/* ----------------------------------------------------------- annotations -- */

export const ANNOTATION_KINDS = [
  'Text',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Ink',
  'FreeText',
  'Square',
  'Circle',
  'Line',
  'Polygon',
  'PolyLine',
  'Stamp',
  'Caret',
  'Popup',
  'FileAttachment',
  'Sound',
  'Link',
  'Widget',
];

/** Removes annotations whose subtype passes `test` (all but form fields by default); returns how many went. */
export function removeAnnotations(doc: PDFDocument, test: (subtype: string) => boolean = (s) => s !== 'Widget'): number {
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = arrayOf(doc, page.node.get(N('Annots')));
    if (!annots) continue;
    const keep: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const item = annots.get(i);
      const subtype = nameOf(doc, dictOf(doc, item), 'Subtype');
      if (test(subtype)) removed++;
      else if (item) keep.push(item);
    }
    if (keep.length) page.node.set(N('Annots'), doc.context.obj(keep));
    else page.node.delete(N('Annots'));
  }
  return removed;
}

/* ---------------------------------------------------- forms and signatures -- */

const fieldsOf = (doc: PDFDocument) => {
  try {
    return doc.getForm().getFields();
  } catch {
    return [];
  }
};

/** Clears every digital signature (the fields stay, empty, unless `dropFields`). Returns how many signatures went. */
export function removeSignatures(doc: PDFDocument, dropFields = false): number {
  let count = 0;
  const form = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  for (const field of fieldsOf(doc)) {
    const dict = field.acroField.dict;
    if (nameOf(doc, dict, 'FT') !== 'Sig') continue;
    if (dict.has(N('V'))) count++;
    dict.delete(N('V'));
    dict.delete(N('Lock'));
    dict.delete(N('SV'));
    if (dropFields) {
      try {
        doc.getForm().removeField(field);
      } catch {
        /* Fields that will not go stay empty. */
      }
    }
  }
  doc.catalog.delete(N('Perms'));
  form?.delete(N('SigFlags'));
  return count;
}

/** Lets every form field be filled in again. Returns how many were locked. */
export function unlockFields(doc: PDFDocument): number {
  let count = 0;
  for (const field of fieldsOf(doc)) {
    if (field.isReadOnly()) {
      field.disableReadOnly();
      count++;
    }
  }
  return count;
}

/** Turns form fields into plain page content. */
export function flattenForm(doc: PDFDocument): number {
  const fields = fieldsOf(doc).length;
  if (!fields) return 0;
  const form = doc.getForm();
  form.updateFieldAppearances();
  // Widgets with no appearance (empty signature fields, say) get an empty one, or flattening stops at them.
  for (const field of form.getFields())
    for (const widget of field.acroField.getWidgets()) {
      const ap = dictOf(doc, widget.dict.get(N('AP')));
      if (ap?.has(N('N'))) continue;
      const r = widget.getRectangle();
      const blankLook = doc.context.formXObject([], { BBox: [0, 0, Math.max(r.width, 1), Math.max(r.height, 1)], Resources: {} });
      widget.dict.set(N('AP'), doc.context.obj({ N: doc.context.register(blankLook) }));
    }
  form.flatten();
  return fields;
}

export interface FieldInfo {
  readonly name: string;
  readonly kind: string;
  readonly page: number;
  /** Rectangle in PDF points, from the bottom-left of the page. */
  readonly rect: readonly [number, number, number, number] | null;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly value: string;
  readonly tooltip: string;
}

/** What sort of field it is (by class, since minified builds rename the classes). */
function kindOf(field: PDFField): string {
  if (field instanceof PDFTextField) return 'Text';
  if (field instanceof PDFCheckBox) return 'Check Box';
  if (field instanceof PDFDropdown) return 'Dropdown';
  if (field instanceof PDFOptionList) return 'Option List';
  if (field instanceof PDFRadioGroup) return 'Radio Group';
  if (field instanceof PDFSignature) return 'Signature';
  if (field instanceof PDFButton) return 'Button';
  return 'Field';
}

export function listFields(doc: PDFDocument): FieldInfo[] {
  const pages = pageIndex(doc);
  return fieldsOf(doc).map((field) => {
    const widget = field.acroField.getWidgets()[0];
    const r = widget?.getRectangle();
    const pageRef = widget?.P();
    let page = pageRef ? (pages.get(pageRef.toString()) ?? 0) : 0;
    if (!page && widget)
      doc.getPages().forEach((p, i) => {
        const annots = arrayOf(doc, p.node.get(N('Annots')));
        for (let k = 0; annots && k < annots.size(); k++) if (dictOf(doc, annots.get(k)) === widget.dict) page = i + 1;
      });
    const kind = kindOf(field);
    let value = '';
    try {
      const v = (field as unknown as { getText?: () => string | undefined; isChecked?: () => boolean; getSelected?: () => string[] | string | undefined }).getText?.();
      const checked = (field as unknown as { isChecked?: () => boolean }).isChecked?.();
      const selected = (field as unknown as { getSelected?: () => string[] | string | undefined }).getSelected?.();
      value = v ?? (checked === undefined ? '' : checked ? 'ticked' : 'not ticked');
      if (selected !== undefined) value = Array.isArray(selected) ? selected.join(', ') : String(selected ?? '');
    } catch {
      value = '';
    }
    return {
      name: field.getName(),
      kind: kind || 'Field',
      page,
      rect: r ? [r.x, r.y, r.width, r.height] : null,
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      value,
      tooltip: textOf(doc, field.acroField.dict.get(N('TU'))),
    };
  });
}

export type NewFieldKind = 'text' | 'multiline' | 'checkbox' | 'dropdown' | 'signature';

export interface NewField {
  readonly kind: NewFieldKind;
  readonly name: string;
  readonly page: number;
  /** Rectangle in PDF points from the bottom-left. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly options?: readonly string[];
  readonly tooltip?: string;
  readonly required?: boolean;
}

export function addField(doc: PDFDocument, f: NewField): void {
  const form = doc.getForm();
  const page = doc.getPage(Math.min(doc.getPageCount(), Math.max(1, f.page)) - 1);
  if (!f.name.trim()) throw new ToolError('Give the field a name.');
  if (form.getFields().some((x) => x.getName() === f.name)) throw new ToolError(`There is already a field called ${f.name}.`);
  const box = { x: f.x, y: f.y, width: f.width, height: f.height };
  let field: { acroField: { dict: PDFDict }; enableRequired?: () => void };
  if (f.kind === 'checkbox') {
    const c = form.createCheckBox(f.name);
    c.addToPage(page, box);
    field = c;
  } else if (f.kind === 'dropdown') {
    const d = form.createDropdown(f.name);
    d.addOptions([...(f.options?.length ? f.options : ['Choice 1', 'Choice 2'])]);
    d.addToPage(page, box);
    field = d;
  } else if (f.kind === 'signature') {
    // pdf-lib has no signature field maker: an empty /Sig field with its widget.
    const widget = doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(f.name), Rect: [f.x, f.y, f.x + f.width, f.y + f.height], F: 4, P: page.ref });
    const ref = doc.context.register(widget);
    page.node.addAnnot(ref);
    doc.catalog.getOrCreateAcroForm().addField(ref);
    if (f.tooltip) widget.set(N('TU'), PDFHexString.fromText(f.tooltip));
    return;
  } else {
    const t = form.createTextField(f.name);
    if (f.kind === 'multiline') t.enableMultiline();
    t.addToPage(page, box);
    field = t;
  }
  if (f.tooltip) field.acroField.dict.set(N('TU'), PDFHexString.fromText(f.tooltip));
  if (f.required) field.enableRequired?.();
}

export function removeField(doc: PDFDocument, name: string): void {
  const form = doc.getForm();
  const field = form.getFields().find((x) => x.getName() === name);
  if (!field) throw new ToolError(`There is no field called ${name}.`);
  form.removeField(field);
}

export function setFieldFlags(doc: PDFDocument, name: string, flags: { readOnly?: boolean; required?: boolean; tooltip?: string }): void {
  const field = doc
    .getForm()
    .getFields()
    .find((x) => x.getName() === name);
  if (!field) throw new ToolError(`There is no field called ${name}.`);
  if (flags.readOnly !== undefined) flags.readOnly ? field.enableReadOnly() : field.disableReadOnly();
  if (flags.required !== undefined) flags.required ? field.enableRequired() : field.disableRequired();
  if (flags.tooltip !== undefined) field.acroField.dict.set(N('TU'), PDFHexString.fromText(flags.tooltip));
}

/* --------------------------------------------------- JavaScript, sanitise -- */

export interface Script {
  readonly where: string;
  readonly code: string;
}

function actionScripts(doc: PDFDocument, action: PDFObject | undefined, where: string, out: Script[], seen = new Set<PDFDict>()): void {
  const a = dictOf(doc, action);
  if (!a || seen.has(a)) return;
  seen.add(a);
  if (nameOf(doc, a, 'S') === 'JavaScript') {
    const js = deref(doc, a.get(N('JS')));
    const code = js instanceof PDFStream ? new TextDecoder().decode(streamBytes(js)) : textOf(doc, js);
    out.push({ where, code });
  }
  const next = deref(doc, a.get(N('Next')));
  if (next instanceof PDFArray) for (let i = 0; i < next.size(); i++) actionScripts(doc, next.get(i), where, out, seen);
  else if (next) actionScripts(doc, next, where, out, seen);
}

const TRIGGERS: Readonly<Record<string, string>> = {
  O: 'page opens',
  C: 'page closes',
  K: 'keystroke',
  F: 'format',
  V: 'validate',
  C_: 'calculate',
  E: 'mouse enters',
  X: 'mouse leaves',
  D: 'mouse down',
  U: 'mouse up',
  Fo: 'focus',
  Bl: 'blur',
  PO: 'page opens',
  PC: 'page closes',
  PV: 'page shown',
  PI: 'page hidden',
  WC: 'document closes',
  WS: 'before saving',
  DS: 'after saving',
  WP: 'before printing',
  DP: 'after printing',
};

function additional(doc: PDFDocument, aa: PDFObject | undefined, where: string, out: Script[]): void {
  const dict = dictOf(doc, aa);
  if (!dict) return;
  for (const [key, value] of dict.entries()) actionScripts(doc, value, `${where}, when ${TRIGGERS[key.decodeText()] ?? key.decodeText()}`, out);
}

/** Every piece of JavaScript in the file, with where it runs. */
export function findJavaScript(doc: PDFDocument): Script[] {
  const out: Script[] = [];
  const names = dictOf(doc, doc.catalog.get(N('Names')));
  for (const [key, value] of nameTree(doc, dictOf(doc, names?.get(N('JavaScript'))))) actionScripts(doc, value, `Document script “${key}”`, out);
  actionScripts(doc, doc.catalog.get(N('OpenAction')), 'When the document opens', out);
  additional(doc, doc.catalog.get(N('AA')), 'Document', out);
  doc.getPages().forEach((page, i) => {
    additional(doc, page.node.get(N('AA')), `Page ${i + 1}`, out);
    const annots = arrayOf(doc, page.node.get(N('Annots')));
    for (let k = 0; annots && k < annots.size(); k++) {
      const a = dictOf(doc, annots.get(k));
      const kind = nameOf(doc, a, 'Subtype') || 'annotation';
      const label = textOf(doc, a?.get(N('T'))) || kind;
      actionScripts(doc, a?.get(N('A')), `Page ${i + 1}, ${label}`, out);
      additional(doc, a?.get(N('AA')), `Page ${i + 1}, ${label}`, out);
    }
  });
  for (const field of fieldsOf(doc)) additional(doc, field.acroField.dict.get(N('AA')), `Field “${field.getName()}”`, out);
  return out;
}

export interface SanitiseOptions {
  readonly javascript: boolean;
  readonly embedded: boolean;
  readonly metadata: boolean;
  readonly links: boolean;
  readonly fonts?: false;
}

const RISKY_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'ResetForm', 'Rendition', 'Sound', 'Movie', 'RichMediaExecute', 'GoToE']);

/** Takes out scripts, embedded files, metadata and outside links, as chosen. Returns what was done. */
export function sanitise(doc: PDFDocument, o: SanitiseOptions): string[] {
  const done: string[] = [];
  const catalog = doc.catalog;
  const names = dictOf(doc, catalog.get(N('Names')));
  if (o.javascript) {
    const before = findJavaScript(doc).length;
    names?.delete(N('JavaScript'));
    catalog.delete(N('AA'));
    const open = dictOf(doc, catalog.get(N('OpenAction')));
    if (open && RISKY_ACTIONS.has(nameOf(doc, open, 'S'))) catalog.delete(N('OpenAction'));
    for (const page of doc.getPages()) {
      page.node.delete(N('AA'));
      const annots = arrayOf(doc, page.node.get(N('Annots')));
      for (let k = 0; annots && k < annots.size(); k++) {
        const a = dictOf(doc, annots.get(k));
        a?.delete(N('AA'));
        const act = dictOf(doc, a?.get(N('A')));
        if (act && RISKY_ACTIONS.has(nameOf(doc, act, 'S'))) a?.delete(N('A'));
      }
    }
    for (const field of fieldsOf(doc)) field.acroField.dict.delete(N('AA'));
    // XFA forms carry their own scripts.
    dictOf(doc, catalog.get(N('AcroForm')))?.delete(N('XFA'));
    done.push(before ? `removed ${before} script${before === 1 ? '' : 's'} and risky actions` : 'found no scripts; risky actions removed');
  }
  if (o.embedded) {
    const count = listAttachments(doc).length;
    removeAttachments(doc, [], true);
    done.push(`removed ${count} attached file${count === 1 ? '' : 's'}`);
  }
  if (o.metadata) {
    catalog.delete(N('Metadata'));
    const info = doc.context.trailerInfo.Info;
    if (info) doc.context.trailerInfo.Info = undefined;
    catalog.delete(N('PieceInfo'));
    for (const page of doc.getPages()) {
      page.node.delete(N('Metadata'));
      page.node.delete(N('PieceInfo'));
    }
    done.push('removed the metadata (title, author, dates, editing history)');
  }
  if (o.links) {
    let count = 0;
    for (const page of doc.getPages()) {
      const annots = arrayOf(doc, page.node.get(N('Annots')));
      for (let k = 0; annots && k < annots.size(); k++) {
        const a = dictOf(doc, annots.get(k));
        const act = dictOf(doc, a?.get(N('A')));
        const s = nameOf(doc, act, 'S');
        if (s === 'URI' || s === 'GoToR') {
          a?.delete(N('A'));
          count++;
        }
      }
    }
    done.push(`removed ${count} link${count === 1 ? '' : 's'} to the web or other files`);
  }
  return done;
}

/* ---------------------------------------------------------------- report -- */

export interface PdfReport {
  readonly [key: string]: unknown;
}

function fontsOn(doc: PDFDocument, resources: PDFDict | undefined, found: Map<string, { type: string; embedded: boolean }>, seen: Set<PDFDict>): void {
  if (!resources || seen.has(resources)) return;
  seen.add(resources);
  const fonts = dictOf(doc, resources.get(N('Font')));
  if (fonts)
    for (const [, value] of fonts.entries()) {
      const font = dictOf(doc, value);
      if (!font) continue;
      const base = nameOf(doc, font, 'BaseFont') || '(unnamed)';
      const type = nameOf(doc, font, 'Subtype');
      let descriptor = dictOf(doc, font.get(N('FontDescriptor')));
      if (!descriptor && type === 'Type0') {
        const kids = arrayOf(doc, font.get(N('DescendantFonts')));
        descriptor = dictOf(doc, dictOf(doc, kids?.get(0))?.get(N('FontDescriptor')));
      }
      const embedded = type === 'Type3' || !!(descriptor && (descriptor.has(N('FontFile')) || descriptor.has(N('FontFile2')) || descriptor.has(N('FontFile3'))));
      found.set(base, { type, embedded });
    }
  const xobjects = dictOf(doc, resources.get(N('XObject')));
  if (xobjects)
    for (const [, value] of xobjects.entries()) {
      const x = dictOf(doc, value);
      if (nameOf(doc, x, 'Subtype') === 'Form') fontsOn(doc, dictOf(doc, x?.get(N('Resources'))), found, seen);
    }
}

function imagesOn(doc: PDFDocument, resources: PDFDict | undefined, seen = new Set<PDFDict>()): { width: number; height: number; filter: string }[] {
  if (!resources || seen.has(resources)) return [];
  seen.add(resources);
  const out: { width: number; height: number; filter: string }[] = [];
  const xobjects = dictOf(doc, resources.get(N('XObject')));
  if (xobjects)
    for (const [, value] of xobjects.entries()) {
      const x = dictOf(doc, value);
      const subtype = nameOf(doc, x, 'Subtype');
      if (subtype === 'Image') {
        const f = deref(doc, x?.get(N('Filter')));
        out.push({
          width: numberOf(doc, x?.get(N('Width'))) ?? 0,
          height: numberOf(doc, x?.get(N('Height'))) ?? 0,
          filter:
            f instanceof PDFName
              ? f.decodeText()
              : f instanceof PDFArray
                ? f
                    .asArray()
                    .map((n) => textOf(doc, n))
                    .join('+')
                : 'none',
        });
      } else if (subtype === 'Form') out.push(...imagesOn(doc, dictOf(doc, x?.get(N('Resources'))), seen));
    }
  return out;
}

/** Fonts used in the document, with whether each is embedded. */
export function listFonts(doc: PDFDocument): { name: string; type: string; embedded: boolean }[] {
  const found = new Map<string, { type: string; embedded: boolean }>();
  const seen = new Set<PDFDict>();
  for (const page of doc.getPages()) fontsOn(doc, dictOf(doc, page.node.get(N('Resources'))), found, seen);
  return [...found.entries()].map(([name, f]) => ({ name, ...f })).sort((a, b) => a.name.localeCompare(b.name));
}

function versionOf(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 20));
  return /%PDF-(\d\.\d)/.exec(head)?.[1] ?? '?';
}

/** Everything this tool can find out about a PDF, as plain data. */
export function report(doc: PDFDocument, bytes: Uint8Array): PdfReport {
  const info: Record<string, string> = {};
  const infoDict = dictOf(doc, doc.context.trailerInfo.Info);
  if (infoDict) for (const [k, v] of infoDict.entries()) info[k.decodeText()] = textOf(doc, v);
  const pages = doc.getPages().map((p, i) => {
    const box = p.getMediaBox();
    const annots = arrayOf(doc, p.node.get(N('Annots')));
    const kinds: Record<string, number> = {};
    for (let k = 0; annots && k < annots.size(); k++) {
      const s = nameOf(doc, dictOf(doc, annots.get(k)), 'Subtype') || '?';
      kinds[s] = (kinds[s] ?? 0) + 1;
    }
    return {
      page: i + 1,
      widthMm: Math.round((box.width / 72) * 25.4 * 10) / 10,
      heightMm: Math.round((box.height / 72) * 25.4 * 10) / 10,
      rotation: p.getRotation().angle,
      annotations: kinds,
      images: imagesOn(doc, dictOf(doc, p.node.get(N('Resources')))),
    };
  });
  const latin = new TextDecoder('latin1').decode(bytes);
  const markInfo = dictOf(doc, doc.catalog.get(N('MarkInfo')));
  return {
    file: { bytes: bytes.length, pdfVersion: versionOf(bytes), incrementalUpdates: Math.max(0, (latin.match(/%%EOF/g)?.length ?? 1) - 1), linearised: /\/Linearized\s/.test(latin.slice(0, 2048)) },
    info,
    xmpMetadata: doc.catalog.has(N('Metadata')),
    pageCount: pages.length,
    tagged: !!markInfo && deref(doc, markInfo.get(N('Marked'))) === PDFBool.True && doc.catalog.has(N('StructTreeRoot')),
    language: textOf(doc, doc.catalog.get(N('Lang'))),
    pageMode: nameOf(doc, doc.catalog, 'PageMode') || 'UseNone',
    fonts: listFonts(doc),
    formFields: listFields(doc).map((f) => ({ name: f.name, kind: f.kind, page: f.page, readOnly: f.readOnly, value: f.value })),
    signatures: listFields(doc)
      .filter((f) => f.kind === 'Signature')
      .map((f) => f.name),
    bookmarks: readOutline(doc).length,
    attachments: listAttachments(doc).map((a) => ({ name: a.name, bytes: a.size, where: a.where })),
    javascript: findJavaScript(doc).map((s) => s.where),
    pages,
  };
}

/* ---------------------------------------------------------- accessibility -- */

export interface Check {
  readonly id: string;
  readonly label: string;
  readonly result: 'pass' | 'warn' | 'fail';
  readonly detail: string;
}

/** Checks against the main machine-testable points of PDF/UA and WCAG for PDFs. `textPages` is how many pages have text (from the text layer). */
export function accessibility(doc: PDFDocument, textPages?: { withText: number; total: number }): Check[] {
  const out: Check[] = [];
  const add = (id: string, label: string, result: Check['result'], detail: string) => out.push({ id, label, result, detail });
  const markInfo = dictOf(doc, doc.catalog.get(N('MarkInfo')));
  const marked = !!markInfo && deref(doc, markInfo.get(N('Marked'))) === PDFBool.True;
  const tree = dictOf(doc, doc.catalog.get(N('StructTreeRoot')));
  add(
    'tagged',
    'Tagged (structure for screen readers)',
    marked && tree ? 'pass' : 'fail',
    marked && tree ? 'The document has a structure tree.' : 'No structure tree: screen readers must guess the reading order. Export with tags (“Tagged PDF”) from the program that made it.',
  );
  const lang = textOf(doc, doc.catalog.get(N('Lang')));
  add('language', 'Language set', lang ? 'pass' : 'fail', lang ? `Language: ${lang}.` : 'No document language: screen readers may read it in the wrong voice.');
  const info = dictOf(doc, doc.context.trailerInfo.Info);
  const title = textOf(doc, info?.get(N('Title')));
  const prefs = dictOf(doc, doc.catalog.get(N('ViewerPreferences')));
  const showsTitle = !!prefs && deref(doc, prefs.get(N('DisplayDocTitle'))) === PDFBool.True;
  add(
    'title',
    'Title shown in the window',
    title && showsTitle ? 'pass' : title ? 'warn' : 'fail',
    title ? (showsTitle ? `Title: ${title}.` : `It has a title (${title}) but viewers are not told to show it instead of the file name.`) : 'No title in the document properties.',
  );
  const fonts = listFonts(doc);
  const missing = fonts.filter((f) => !f.embedded);
  add(
    'fonts',
    'Fonts embedded',
    missing.length ? 'fail' : 'pass',
    missing.length ? `Not embedded: ${missing.map((f) => f.name).join(', ')}.` : fonts.length ? `All ${fonts.length} fonts are embedded.` : 'No fonts (the pages may be pictures only).',
  );
  if (textPages)
    add(
      'text',
      'Real text, not only pictures',
      textPages.withText === textPages.total ? 'pass' : textPages.withText === 0 ? 'fail' : 'warn',
      textPages.withText === textPages.total
        ? 'Every page has text.'
        : `${textPages.total - textPages.withText} of ${textPages.total} pages have no text: they are probably scans and need OCR (PDF Studio).`,
    );
  // Figures need alternative text.
  let figures = 0;
  let described = 0;
  const walk = (node: PDFObject | undefined, depth: number) => {
    const o = deref(doc, node);
    if (depth > 200) return;
    if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) walk(o.get(i), depth + 1);
    else if (o instanceof PDFDict) {
      if (nameOf(doc, o, 'S') === 'Figure') {
        figures++;
        if (textOf(doc, o.get(N('Alt'))) || textOf(doc, o.get(N('ActualText')))) described++;
      }
      walk(o.get(N('K')), depth + 1);
    }
  };
  if (tree) walk(tree.get(N('K')), 0);
  if (tree) add('alt', 'Pictures described', figures === described ? 'pass' : 'fail', figures ? `${described} of ${figures} figures have alternative text.` : 'No figures are tagged.');
  const pages = doc.getPageCount();
  const bookmarks = readOutline(doc).length;
  add(
    'bookmarks',
    'Bookmarks for long documents',
    pages <= 20 || bookmarks > 0 ? 'pass' : 'warn',
    pages > 20 ? (bookmarks ? `${bookmarks} top-level bookmarks.` : `${pages} pages and no bookmarks to find one’s way.`) : 'Short enough not to need them.',
  );
  const fields = listFields(doc);
  const untitled = fields.filter((f) => !f.tooltip && f.kind !== 'Signature');
  if (fields.length)
    add(
      'fields',
      'Form fields described',
      untitled.length ? 'fail' : 'pass',
      untitled.length ? `${untitled.length} of ${fields.length} fields have no description (tooltip) for screen readers.` : 'Every field has a description.',
    );
  const withAnnots = doc.getPages().filter((p) => (arrayOf(doc, p.node.get(N('Annots')))?.size() ?? 0) > 0);
  const ordered = withAnnots.filter((p) => nameOf(doc, p.node, 'Tabs') === 'S');
  if (withAnnots.length)
    add(
      'tabs',
      'Tab order follows the structure',
      ordered.length === withAnnots.length ? 'pass' : 'warn',
      `${ordered.length} of ${withAnnots.length} pages with links or fields set the tab order to the structure.`,
    );
  const xmp = deref(doc, doc.catalog.get(N('Metadata')));
  const packet = xmp instanceof PDFStream ? new TextDecoder().decode(streamBytes(xmp)) : '';
  add(
    'pdfua',
    'Claims PDF/UA',
    /pdfuaid:part/.test(packet) ? 'pass' : 'warn',
    /pdfuaid:part/.test(packet) ? 'The metadata says it meets PDF/UA.' : 'Not marked as PDF/UA (optional; the checks above matter more).',
  );
  return out;
}

/* ----------------------------------------------------------------- pages -- */

export const PAPER = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
  Tabloid: [792, 1224],
} as const;

/** Every page put on one tall page (or one wide page), keeping their sizes. */
export async function onePage(source: PDFDocument, target: PDFDocument, direction: 'down' | 'across', gap = 0): Promise<void> {
  const embedded = await target.embedPages(source.getPages());
  const sizes = embedded.map((e) => ({ w: e.width, h: e.height }));
  const width = direction === 'down' ? Math.max(...sizes.map((s) => s.w)) : sizes.reduce((a, s) => a + s.w, 0) + gap * (sizes.length - 1);
  const height = direction === 'down' ? sizes.reduce((a, s) => a + s.h, 0) + gap * (sizes.length - 1) : Math.max(...sizes.map((s) => s.h));
  if (width > 14400 || height > 14400) throw new ToolError(`That would make a page ${Math.round(width)} × ${Math.round(height)} points; PDF pages can be at most 14400 points (5 m) on a side.`);
  const page = target.addPage([width, height]);
  let at = direction === 'down' ? height : 0;
  embedded.forEach((e, i) => {
    const s = sizes[i] ?? { w: 0, h: 0 };
    if (direction === 'down') {
      at -= s.h;
      page.drawPage(e, { x: (width - s.w) / 2, y: at });
      at -= gap;
    } else {
      page.drawPage(e, { x: at, y: height - s.h });
      at += s.w + gap;
    }
  });
}

/** Pages redrawn on a new paper size, fitted (or scaled by `percent`) and centred. */
export async function resizePages(
  source: PDFDocument,
  target: PDFDocument,
  size: readonly [number, number] | null,
  orientation: 'keep' | 'portrait' | 'landscape',
  percent: number | null,
): Promise<void> {
  const embedded = await target.embedPages(source.getPages());
  embedded.forEach((e) => {
    let [w, h] = size ?? [e.width, e.height];
    const landscape = orientation === 'landscape' || (orientation === 'keep' && e.width > e.height);
    if ((landscape && w < h) || (!landscape && w > h)) [w, h] = [h, w];
    const k = percent !== null ? percent / 100 : Math.min(w / e.width, h / e.height);
    const page = target.addPage([w, h]);
    page.drawPage(e, { x: (w - e.width * k) / 2, y: (h - e.height * k) / 2, xScale: k, yScale: k });
  });
}

/** Blank pages inserted after the given pages (0: before the first), the size of their neighbour. */
export function insertBlankPages(doc: PDFDocument, after: readonly number[], count = 1): number {
  const sorted = [...new Set(after)].filter((n) => n >= 0 && n <= doc.getPageCount()).sort((a, b) => b - a);
  for (const n of sorted) {
    const near = doc.getPage(Math.max(0, Math.min(doc.getPageCount() - 1, n === 0 ? 0 : n - 1)));
    const { width, height } = near.getSize();
    for (let i = 0; i < count; i++) doc.insertPage(n, [width, height]);
  }
  return sorted.length * count;
}

/** Pages of `over` laid on (or under) the pages of `base`: the first only, repeated, or page for page. */
export async function overlay(base: PDFDocument, over: PDFDocument, mode: 'over' | 'under', pattern: 'first' | 'repeat' | 'match', opacity = 1): Promise<void> {
  const embedded = await base.embedPages(over.getPages());
  if (!embedded.length) throw new ToolError('The overlay PDF has no pages.');
  base.getPages().forEach((page, i) => {
    const e = pattern === 'first' ? embedded[0] : pattern === 'repeat' ? embedded[i % embedded.length] : embedded[i];
    if (!e) return;
    const { width, height } = page.getSize();
    const k = Math.min(width / e.width, height / e.height);
    page.drawPage(e, { x: (width - e.width * k) / 2, y: (height - e.height * k) / 2, xScale: k, yScale: k, opacity });
    if (mode === 'under') {
      // The drawing went last: move its content stream to the front so the page is painted over it.
      const contents = arrayOf(base, page.node.get(N('Contents')));
      if (contents && contents.size() > 1) {
        const items = contents.asArray();
        const last = items[items.length - 1] as PDFObject;
        page.node.set(N('Contents'), base.context.obj([last, ...items.slice(0, -1)]));
      }
    }
  });
}

/* ------------------------------------------------------------ timestamps -- */

/** The space a document timestamp's token is written into (hex digits = twice this). */
export const TIMESTAMP_SPACE = 12_000;
const PLACEHOLDER = '**********';

/**
 * Adds an RFC 3161 document-timestamp dictionary with room for the token,
 * saves, and returns the file with the byte range filled in and the bytes to
 * hash (everything but the space).
 */
export async function prepareTimestamp(doc: PDFDocument): Promise<{ pdf: Uint8Array; signed: Uint8Array; contentsAt: number }> {
  const context = doc.context;
  const sig = context.obj({
    Type: 'DocTimeStamp',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.RFC3161',
    ByteRange: [0, N(PLACEHOLDER), N(PLACEHOLDER), N(PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(TIMESTAMP_SPACE * 2)),
  });
  const page = doc.getPage(0);
  const fieldCount = doc.catalog.getOrCreateAcroForm().getAllFields().length;
  const widget = context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: context.register(sig), T: PDFString.of(`Timestamp${fieldCount + 1}`), F: 132, P: page.ref });
  const ref = context.register(widget);
  page.node.addAnnot(ref);
  const form = doc.catalog.getOrCreateAcroForm();
  form.addField(ref);
  form.dict.set(N('SigFlags'), PDFNumber.of(3));
  const pdf = await doc.save({ useObjectStreams: false });
  const latin = new TextDecoder('latin1').decode(pdf);
  const placeholder = `/ByteRange [ 0 /${PLACEHOLDER} /${PLACEHOLDER} /${PLACEHOLDER} ]`;
  const rangeAt = latin.indexOf(placeholder);
  const zeros = `<${'0'.repeat(TIMESTAMP_SPACE * 2)}>`;
  const contentsAt = latin.indexOf(zeros);
  if (rangeAt < 0 || contentsAt < 0) throw new ToolError('Could not make room for the timestamp in this PDF.');
  const end = contentsAt + zeros.length;
  const filled = `/ByteRange [ 0 ${contentsAt} ${end} ${pdf.length - end} ]`.padEnd(placeholder.length, ' ');
  if (filled.length > placeholder.length) throw new ToolError('This PDF is too large to timestamp.');
  const out = pdf.slice();
  out.set(new TextEncoder().encode(filled), rangeAt);
  const signed = new Uint8Array(contentsAt + (out.length - end));
  signed.set(out.subarray(0, contentsAt), 0);
  signed.set(out.subarray(end), contentsAt);
  return { pdf: out, signed, contentsAt };
}

/** Writes the timestamp token (DER) into the space left by prepareTimestamp. */
export function insertTimestamp(pdf: Uint8Array, contentsAt: number, token: Uint8Array): Uint8Array {
  const hex = Array.from(token, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length > TIMESTAMP_SPACE * 2) throw new ToolError('The timestamp server sent a token too large to fit.');
  const out = pdf.slice();
  out.set(new TextEncoder().encode(`<${hex.padEnd(TIMESTAMP_SPACE * 2, '0')}>`), contentsAt);
  return out;
}

/* ---------------------------------------------------------- minimal DER -- */

const derLength = (n: number): number[] => {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
};
const der = (tag: number, body: readonly number[]): number[] => [tag, ...derLength(body.length), ...body];

/** An RFC 3161 TimeStampReq for a SHA-256 digest, asking for the TSA's certificate. */
export function timestampRequest(sha256: Uint8Array, nonce: Uint8Array): Uint8Array {
  const sha256Oid = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
  const algorithm = der(0x30, [...sha256Oid, 0x05, 0x00]);
  const imprint = der(0x30, [...algorithm, ...der(0x04, [...sha256])]);
  const nonceBytes = nonce[0] !== undefined && nonce[0] >= 0x80 ? [0, ...nonce] : [...nonce];
  return new Uint8Array(der(0x30, [0x02, 0x01, 0x01, ...imprint, ...der(0x02, nonceBytes), 0x01, 0x01, 0xff]));
}

/** Reads one DER element at `at`: its tag, where its body starts and ends. */
function readDer(bytes: Uint8Array, at: number): { tag: number; start: number; end: number } {
  const tag = bytes[at] ?? 0;
  let len = bytes[at + 1] ?? 0;
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (bytes[start + i] ?? 0);
    start += n;
  }
  return { tag, start, end: start + len };
}

/** The TimeStampToken out of a TimeStampResp, or an error saying why the server refused. */
export function timestampToken(response: Uint8Array): Uint8Array {
  const outer = readDer(response, 0);
  if (outer.tag !== 0x30) throw new ToolError('The timestamp server’s answer is not a timestamp response.');
  const status = readDer(response, outer.start);
  const code = readDer(response, status.start);
  const value = response[code.start] ?? 255;
  if (value > 1) throw new ToolError(`The timestamp server refused the request (status ${value}).`);
  if (status.end >= outer.end) throw new ToolError('The timestamp server sent no token.');
  const token = readDer(response, status.end);
  return response.slice(status.end, token.end);
}
