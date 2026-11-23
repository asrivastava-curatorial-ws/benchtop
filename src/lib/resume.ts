/**
 * Résumés for the Resume Builder, kept in Reactive Resume's own format
 * (version 5, the "Reactive Resume JSON" export of rxresu.me), so a résumé
 * moves between Benchtop and Reactive Resume without losing anything: fields
 * this editor does not show are carried along untouched.  Reactive Resume 4
 * exports and JSON Resume (jsonresume.org) files open too, and JSON Resume is
 * written out as well.  Pages are drawn with templates of Benchtop's own and
 * printed to PDF by the browser engine.
 */

/* ----------------------------------------------------------- the model -- */

export const SECTION_TYPES = ['profiles', 'experience', 'education', 'projects', 'skills', 'languages', 'interests', 'awards', 'certifications', 'publications', 'volunteer', 'references'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABELS: Record<SectionType | 'summary', string> = {
  summary: 'Summary',
  profiles: 'Profiles',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  languages: 'Languages',
  interests: 'Interests',
  awards: 'Awards',
  certifications: 'Certifications',
  publications: 'Publications',
  volunteer: 'Volunteering',
  references: 'References',
};

export interface Website {
  url: string;
  label: string;
  inlineLink?: boolean;
}

export interface Item {
  id: string;
  hidden: boolean;
  [field: string]: unknown;
}

export interface Section {
  title: string;
  icon: string;
  columns: number;
  hidden: boolean;
  showHeading?: boolean;
  keepTogether?: boolean;
  startOnNewPage?: boolean;
  items: Item[];
  [field: string]: unknown;
}

export interface CustomSection extends Section {
  id: string;
  type: string;
}

export interface PageLayout {
  fullWidth: boolean;
  main: string[];
  sidebar: string[];
}

export interface Resume {
  picture: {
    hidden: boolean;
    fit: 'cover' | 'contain';
    url: string;
    size: number;
    rotation: number;
    aspectRatio: number;
    borderRadius: number;
    borderColor: string;
    borderWidth: number;
    shadowColor: string;
    shadowWidth: number;
  };
  basics: {
    name: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    website: Website;
    customFields: { id: string; icon: string; text: string; link: string }[];
    [field: string]: unknown;
  };
  summary: { title: string; icon: string; columns: number; hidden: boolean; showHeading?: boolean; keepTogether?: boolean; startOnNewPage?: boolean; content: string; [field: string]: unknown };
  sections: Record<SectionType, Section>;
  customSections: CustomSection[];
  metadata: {
    template: string;
    layout: { sidebarWidth: number; sidebarSide?: 'left' | 'right'; pages: PageLayout[] };
    page: {
      gapX: number;
      gapY: number;
      marginX: number;
      marginY: number;
      format: 'a4' | 'letter' | 'free-form';
      locale: string;
      dateFormat?: string;
      hideLinkUnderline: boolean;
      hideIcons: boolean;
      hideSectionIcons: boolean;
      [field: string]: unknown;
    };
    design: { colors: { primary: string; text: string; background: string }; level: { icon: string; type: string }; [field: string]: unknown };
    typography: { body: Typography; heading: Typography; [field: string]: unknown };
    notes: string;
    styleRules: unknown[];
    [field: string]: unknown;
  };
  /** Benchtop's own settings; Reactive Resume keeps unknown top-level fields. */
  benchtop?: { template: TemplateId };
  [field: string]: unknown;
}

export interface Typography {
  fontFamily: string;
  fontWeights: string[];
  fontSize: number;
  lineHeight: number;
}

export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly kind?: 'text' | 'rich' | 'level' | 'keywords' | 'website';
  readonly placeholder?: string;
}

const t = (key: string, label: string, placeholder?: string): FieldSpec => ({ key, label, kind: 'text', placeholder });
const PERIOD = t('period', 'Period', 'Jan 2022 – Present');
const DATE = t('date', 'Date', 'Mar 2024');
const LINK: FieldSpec = { key: 'website', label: 'Link', kind: 'website' };
const ABOUT: FieldSpec = { key: 'description', label: 'Description', kind: 'rich' };

/** The fields of each kind of entry, in the order the editor shows them. */
export const FIELDS: Record<SectionType, readonly FieldSpec[]> = {
  profiles: [t('network', 'Network', 'GitHub'), t('username', 'Username'), LINK],
  experience: [t('company', 'Company'), t('position', 'Position'), t('location', 'Location'), PERIOD, LINK, ABOUT],
  education: [t('school', 'School'), t('degree', 'Degree'), t('area', 'Subject'), t('grade', 'Grade'), t('location', 'Location'), PERIOD, LINK, ABOUT],
  projects: [t('name', 'Name'), PERIOD, LINK, ABOUT],
  skills: [t('name', 'Skill'), t('proficiency', 'Proficiency', 'Advanced'), { key: 'level', label: 'Level', kind: 'level' }, { key: 'keywords', label: 'Keywords', kind: 'keywords' }],
  languages: [t('language', 'Language'), t('fluency', 'Fluency', 'Native'), { key: 'level', label: 'Level', kind: 'level' }],
  interests: [t('name', 'Interest'), { key: 'keywords', label: 'Keywords', kind: 'keywords' }],
  awards: [t('title', 'Title'), t('awarder', 'Awarded by'), DATE, LINK, ABOUT],
  certifications: [t('title', 'Title'), t('issuer', 'Issuer'), DATE, LINK, ABOUT],
  publications: [t('title', 'Title'), t('publisher', 'Publisher'), DATE, LINK, ABOUT],
  volunteer: [t('organization', 'Organisation'), t('location', 'Location'), PERIOD, LINK, ABOUT],
  references: [t('name', 'Name'), t('position', 'Position'), t('phone', 'Phone'), LINK, ABOUT],
};

/** The field that names an entry in lists. */
const LEAD: Record<SectionType, readonly string[]> = {
  profiles: ['network', 'username'],
  experience: ['position', 'company'],
  education: ['school', 'degree'],
  projects: ['name'],
  skills: ['name'],
  languages: ['language'],
  interests: ['name'],
  awards: ['title'],
  certifications: ['title'],
  publications: ['title'],
  volunteer: ['organization'],
  references: ['name'],
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function itemLabel(type: SectionType, item: Item): string {
  const [first, second] = LEAD[type];
  const a = str(item[first as string]);
  const b = second ? str(item[second]) : '';
  return [a, b].filter(Boolean).join(' · ') || 'Untitled entry';
}

export const isSectionType = (v: unknown): v is SectionType => typeof v === 'string' && (SECTION_TYPES as readonly string[]).includes(v);

/* ----------------------------------------------------------- templates -- */

export const TEMPLATES = ['classic', 'sidebar', 'banner', 'compact'] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export const TEMPLATE_INFO: Record<TemplateId, { name: string; about: string; columns: 1 | 2 }> = {
  classic: { name: 'Classic', about: 'One column, centred name, rules under headings', columns: 1 },
  sidebar: { name: 'Sidebar', about: 'Photo and short sections in a tinted side column', columns: 2 },
  banner: { name: 'Banner', about: 'Name on a band of colour, two columns below', columns: 2 },
  compact: { name: 'Compact', about: 'Dense, headings in a margin column; fits more on a page', columns: 1 },
};

/* ------------------------------------------------------------ defaults -- */

let counter = 0;
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter}`;
}

const SECTION_ICONS: Record<SectionType, string> = {
  profiles: 'messenger-logo',
  experience: 'briefcase',
  education: 'graduation-cap',
  projects: 'code-simple',
  skills: 'compass-tool',
  languages: 'translate',
  interests: 'football',
  awards: 'trophy',
  certifications: 'certificate',
  publications: 'books',
  volunteer: 'hand-heart',
  references: 'phone',
};

const sectionDefaults = (icon: string) => ({ title: '', icon, columns: 1, hidden: false, showHeading: true, keepTogether: false, startOnNewPage: false });

export function emptyResume(): Resume {
  const sections = Object.fromEntries(
    SECTION_TYPES.map((type) => [type, { ...sectionDefaults(SECTION_ICONS[type]), items: [] as Item[], ...(type === 'skills' ? { layout: 'default', keywordLayout: 'inline' } : {}) }]),
  ) as Record<SectionType, Section>;
  return {
    picture: {
      hidden: false,
      fit: 'cover',
      url: '',
      size: 80,
      rotation: 0,
      aspectRatio: 1,
      borderRadius: 0,
      borderColor: 'rgba(0, 0, 0, 0.5)',
      borderWidth: 0,
      shadowColor: 'rgba(0, 0, 0, 0.5)',
      shadowWidth: 0,
    },
    basics: { name: '', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' }, customFields: [] },
    summary: { ...sectionDefaults('article'), content: '' },
    sections,
    customSections: [],
    metadata: {
      template: 'onyx',
      layout: {
        sidebarWidth: 35,
        pages: [
          {
            fullWidth: false,
            main: ['summary', 'experience', 'education', 'projects', 'volunteer', 'references', 'profiles'],
            sidebar: ['skills', 'certifications', 'awards', 'languages', 'interests', 'publications'],
          },
        ],
      },
      page: { gapX: 4, gapY: 6, marginX: 14, marginY: 12, format: 'a4', locale: 'en-US', dateFormat: 'short', hideLinkUnderline: false, hideIcons: false, hideSectionIcons: true },
      design: {
        colors: { primary: 'rgba(31, 111, 235, 1)', text: 'rgba(0, 0, 0, 1)', background: 'rgba(255, 255, 255, 1)' },
        level: { icon: 'star', type: 'circle' },
        entry: { layout: 'stacked', lead: 'organization', accent: 'none' },
      },
      typography: {
        body: { fontFamily: 'Barlow', fontWeights: ['400', '500'], fontSize: 10, lineHeight: 1.45 },
        heading: { fontFamily: 'Barlow', fontWeights: ['600'], fontSize: 14, lineHeight: 1.3 },
      },
      notes: '',
      styleRules: [],
    },
    benchtop: { template: 'classic' },
  };
}

export function newItem(type: SectionType): Item {
  const item: Item = { id: newId(), hidden: false };
  for (const field of FIELDS[type]) {
    if (field.kind === 'website') item[field.key] = { url: '', label: '', inlineLink: false };
    else if (field.kind === 'level') item[field.key] = 0;
    else if (field.kind === 'keywords') item[field.key] = [];
    else item[field.key] = '';
  }
  if (type === 'experience') item.roles = [];
  if (type === 'skills' || type === 'interests' || type === 'profiles') {
    item.icon = '';
    item.iconColor = '';
  }
  return item;
}

/* -------------------------------------------------------------- reading -- */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function website(v: unknown): Website {
  if (typeof v === 'string') return { url: v, label: '', inlineLink: false };
  if (!isRecord(v)) return { url: '', label: '', inlineLink: false };
  return { url: str(v.url) || str(v.href), label: str(v.label), inlineLink: bool(v.inlineLink, false) };
}

function normaliseItem(type: SectionType, raw: unknown): Item {
  const base = newItem(type);
  if (!isRecord(raw)) return base;
  const item: Item = { ...raw, id: str(raw.id) || base.id, hidden: bool(raw.hidden, false) };
  for (const field of FIELDS[type]) {
    const value = raw[field.key];
    if (field.kind === 'website') item[field.key] = website(value);
    else if (field.kind === 'level') item[field.key] = num(value, 0, 0, 5);
    else if (field.kind === 'keywords') item[field.key] = strings(value);
    else item[field.key] = str(value);
  }
  if (type === 'experience') item.roles = Array.isArray(raw.roles) ? raw.roles.filter(isRecord) : [];
  if (type === 'skills' || type === 'interests' || type === 'profiles') {
    item.icon = str(raw.icon);
    item.iconColor = str(raw.iconColor);
  }
  return item;
}

function normaliseSection(type: SectionType, raw: unknown, fallback: Section): Section {
  if (!isRecord(raw)) return fallback;
  return {
    ...raw,
    title: str(raw.title),
    icon: str(raw.icon) || fallback.icon,
    columns: num(raw.columns, 1, 1, 6),
    hidden: bool(raw.hidden, false),
    showHeading: bool(raw.showHeading, true),
    keepTogether: bool(raw.keepTogether, false),
    startOnNewPage: bool(raw.startOnNewPage, false),
    items: Array.isArray(raw.items) ? raw.items.map((i) => normaliseItem(type, i)) : [],
  };
}

const deepMerge = (base: Record<string, unknown>, extra: unknown): Record<string, unknown> => {
  if (!isRecord(extra)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = isRecord(v) && isRecord(base[k]) ? deepMerge(base[k] as Record<string, unknown>, v) : v === undefined ? base[k] : v;
  return out;
};

/** A Reactive Resume 5 résumé with every field this editor relies on present; anything else is kept. */
export function normalise(raw: unknown): Resume {
  const d = emptyResume();
  const r = isRecord(raw) ? raw : {};
  const basics = isRecord(r.basics) ? r.basics : {};
  const summary = isRecord(r.summary) ? r.summary : {};
  const sections = isRecord(r.sections) ? r.sections : {};
  const metadata = deepMerge(d.metadata as unknown as Record<string, unknown>, r.metadata) as unknown as Resume['metadata'];
  const pages = Array.isArray(metadata.layout?.pages) ? metadata.layout.pages.filter(isRecord) : [];
  metadata.layout = {
    ...metadata.layout,
    sidebarWidth: num(metadata.layout?.sidebarWidth, 35, 10, 50),
    pages: (pages.length ? pages : d.metadata.layout.pages).map((p) => ({ ...p, fullWidth: bool(p.fullWidth, false), main: strings(p.main), sidebar: strings(p.sidebar) })),
  };
  metadata.page = {
    ...metadata.page,
    format: metadata.page.format === 'letter' || metadata.page.format === 'free-form' ? metadata.page.format : 'a4',
    marginX: num(metadata.page.marginX, 14, 0, 100),
    marginY: num(metadata.page.marginY, 12, 0, 100),
    gapY: num(metadata.page.gapY, 6, 0, 60),
    gapX: num(metadata.page.gapX, 4, 0, 60),
  };
  for (const part of ['body', 'heading'] as const) {
    const ty = metadata.typography[part];
    metadata.typography[part] = {
      ...ty,
      fontFamily: str(ty?.fontFamily) || d.metadata.typography[part].fontFamily,
      fontWeights: strings(ty?.fontWeights).length ? strings(ty?.fontWeights) : d.metadata.typography[part].fontWeights,
      fontSize: num(ty?.fontSize, d.metadata.typography[part].fontSize, 6, 24),
      lineHeight: num(ty?.lineHeight, d.metadata.typography[part].lineHeight, 0.5, 4),
    };
  }
  const picture = isRecord(r.picture) ? r.picture : {};
  const resume: Resume = {
    ...r,
    picture: {
      ...d.picture,
      ...picture,
      hidden: bool(picture.hidden, false),
      fit: picture.fit === 'contain' ? 'contain' : 'cover',
      url: str(picture.url),
      size: num(picture.size, 80, 32, 512),
      rotation: num(picture.rotation, 0, 0, 360),
      aspectRatio: num(picture.aspectRatio, 1, 0.5, 2.5),
      borderRadius: num(picture.borderRadius, 0, 0, 100),
      borderColor: str(picture.borderColor) || d.picture.borderColor,
      borderWidth: num(picture.borderWidth, 0, 0),
      shadowColor: str(picture.shadowColor) || d.picture.shadowColor,
      shadowWidth: num(picture.shadowWidth, 0, 0),
    },
    basics: {
      ...basics,
      name: str(basics.name),
      headline: str(basics.headline),
      email: str(basics.email),
      phone: str(basics.phone),
      location: str(basics.location),
      website: (({ url, label }) => ({ url, label }))(website(basics.website)),
      customFields: Array.isArray(basics.customFields)
        ? basics.customFields.filter(isRecord).map((f) => ({ ...f, id: str(f.id) || newId(), icon: str(f.icon), text: str(f.text), link: str(f.link) }))
        : [],
    },
    summary: { ...d.summary, ...summary, title: str(summary.title), hidden: bool(summary.hidden, false), content: str(summary.content), columns: num(summary.columns, 1, 1, 6) },
    sections: Object.fromEntries(SECTION_TYPES.map((type) => [type, normaliseSection(type, sections[type], d.sections[type])])) as Record<SectionType, Section>,
    customSections: Array.isArray(r.customSections)
      ? r.customSections.filter(isRecord).map((c) => {
          const type = isSectionType(c.type) ? c.type : 'projects';
          return { ...normaliseSection(type, c, { ...sectionDefaults(''), items: [] }), id: str(c.id) || newId(), type: str(c.type) || type };
        })
      : [],
    metadata,
    benchtop: { template: isRecord(r.benchtop) && (TEMPLATES as readonly string[]).includes(str(r.benchtop.template)) ? (str(r.benchtop.template) as TemplateId) : 'classic' },
  };
  return resume;
}

/* ---------------------------------------------- Reactive Resume 4 files -- */

/** Reactive Resume 4 kept dates in one text field, titles as "name" and visibility as "visible". */
function fromReactiveV4(r: Record<string, unknown>): Resume {
  const out = emptyResume();
  const b = isRecord(r.basics) ? r.basics : {};
  const s = isRecord(r.sections) ? r.sections : {};
  const m = isRecord(r.metadata) ? r.metadata : {};
  out.basics = {
    ...out.basics,
    name: str(b.name),
    headline: str(b.headline),
    email: str(b.email),
    phone: str(b.phone),
    location: str(b.location),
    website: (({ url, label }) => ({ url, label }))(website(b.url)),
  };
  out.basics.customFields = Array.isArray(b.customFields)
    ? b.customFields.filter(isRecord).map((f) => ({ id: str(f.id) || newId(), icon: str(f.icon), text: str(f.value) || str(f.name), link: '' }))
    : [];
  const pic = isRecord(b.picture) ? b.picture : {};
  out.picture = {
    ...out.picture,
    url: str(pic.url),
    size: num(pic.size, 80, 32, 512),
    aspectRatio: num(pic.aspectRatio, 1, 0.5, 2.5),
    borderRadius: num(pic.borderRadius, 0, 0, 100),
    hidden: isRecord(pic.effects) ? bool(pic.effects.hidden, false) : false,
  };
  const visible = (v: unknown) => !(isRecord(v) && v.visible === false);
  const sum = isRecord(s.summary) ? s.summary : {};
  out.summary = { ...out.summary, title: str(sum.name), content: str(sum.content), hidden: !visible(sum), columns: num(sum.columns, 1, 1, 6) };
  const rename: Record<SectionType, Record<string, string>> = {
    profiles: {},
    experience: { date: 'period', summary: 'description' },
    education: { institution: 'school', studyType: 'degree', score: 'grade', date: 'period', summary: 'description' },
    projects: { date: 'period', summary: 'description' },
    skills: { description: 'proficiency' },
    languages: { name: 'language', description: 'fluency' },
    interests: {},
    awards: { summary: 'description' },
    certifications: { name: 'title', summary: 'description' },
    publications: { name: 'title', summary: 'description' },
    volunteer: { date: 'period', summary: 'description' },
    references: { description: 'position', summary: 'description' },
  };
  const convertItem = (type: SectionType, raw: unknown) => {
    if (!isRecord(raw)) return normaliseItem(type, raw);
    const item: Record<string, unknown> = { id: raw.id, hidden: raw.visible === false };
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'id' || k === 'visible') continue;
      if (k === 'url') item.website = website(v);
      else item[rename[type][k] ?? k] = v;
    }
    return normaliseItem(type, item);
  };
  for (const type of SECTION_TYPES) {
    const sec = s[type];
    if (!isRecord(sec)) continue;
    out.sections[type] = {
      ...out.sections[type],
      title: str(sec.name),
      hidden: !visible(sec),
      columns: num(sec.columns, 1, 1, 6),
      items: Array.isArray(sec.items) ? sec.items.map((i) => convertItem(type, i)) : [],
    };
  }
  if (isRecord(s.custom)) {
    for (const [id, sec] of Object.entries(s.custom)) {
      if (!isRecord(sec)) continue;
      const items = Array.isArray(sec.items)
        ? sec.items
            .filter(isRecord)
            .map((i) =>
              normaliseItem('projects', { id: i.id, hidden: i.visible === false, name: str(i.name), period: str(i.date), website: website(i.url), description: str(i.summary) || str(i.description) }),
            )
        : [];
      out.customSections.push({ ...sectionDefaults(''), id, type: 'projects', title: str(sec.name), hidden: !visible(sec), items });
    }
  }
  // v4 layout: pages → columns → section ids; custom sections were "custom.<id>".
  if (Array.isArray(m.layout)) {
    const pages = m.layout.filter(Array.isArray).map((page: unknown[]) => {
      const [main, sidebar] = page.map((col) => strings(col).map((id) => id.replace(/^custom\./, '')));
      return { fullWidth: !sidebar?.length, main: main ?? [], sidebar: sidebar ?? [] };
    });
    if (pages.length) out.metadata.layout.pages = pages;
  }
  const theme = isRecord(m.theme) ? m.theme : {};
  if (str(theme.primary)) out.metadata.design.colors.primary = str(theme.primary);
  if (str(theme.text)) out.metadata.design.colors.text = str(theme.text);
  const page = isRecord(m.page) ? m.page : {};
  if (page.format === 'letter') out.metadata.page.format = 'letter';
  const typo = isRecord(m.typography) ? m.typography : {};
  const font = isRecord(typo.font) ? typo.font : {};
  if (str(font.family)) out.metadata.typography.body.fontFamily = out.metadata.typography.heading.fontFamily = str(font.family);
  if (typeof font.size === 'number') out.metadata.typography.body.fontSize = num(font.size, 10, 6, 24);
  if (typeof typo.lineHeight === 'number') out.metadata.typography.body.lineHeight = num(typo.lineHeight, 1.45, 0.5, 4);
  out.metadata.notes = str(m.notes);
  return normalise(out);
}

/* ------------------------------------------------------- JSON Resume -- */

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text and highlights as the rich text Reactive Resume stores. */
function richFrom(summary: unknown, highlights?: unknown): string {
  const parts: string[] = [];
  const text = str(summary).trim();
  if (text)
    parts.push(
      text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join(''),
    );
  const list = strings(highlights).filter((h) => h.trim());
  if (list.length) parts.push(`<ul>${list.map((h) => `<li><p>${escapeHtml(h)}</p></li>`).join('')}</ul>`);
  return parts.join('');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2021-03-01" → "Mar 2021"; "2021" stays as it is. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(iso.trim());
  if (!m) return iso.trim();
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined;
  return month ? `${month} ${m[1]}` : (m[1] as string);
}

function period(start: unknown, end: unknown): string {
  const a = str(start) ? shortDate(str(start)) : '';
  const b = str(end) ? shortDate(str(end)) : a ? 'Present' : '';
  return a ? `${a} – ${b}` : b;
}

function fromJsonResume(j: Record<string, unknown>): Resume {
  const out = emptyResume();
  const b = isRecord(j.basics) ? j.basics : {};
  const loc = isRecord(b.location) ? b.location : {};
  out.basics = {
    ...out.basics,
    name: str(b.name),
    headline: str(b.label),
    email: str(b.email),
    phone: str(b.phone),
    location: [str(loc.city), str(loc.region), str(loc.countryCode)].filter(Boolean).join(', ') || str(loc.address),
    website: { url: str(b.url), label: '' },
  };
  if (str(b.image).startsWith('data:image/')) out.picture.url = str(b.image);
  out.summary.content = richFrom(b.summary);
  const list = (key: string) => (Array.isArray(j[key]) ? (j[key] as unknown[]).filter(isRecord) : []);
  const add = (type: SectionType, rows: Record<string, unknown>[], map: (r: Record<string, unknown>) => Record<string, unknown>) => {
    out.sections[type].items = rows.map((r) => normaliseItem(type, map(r)));
  };
  add('profiles', Array.isArray(b.profiles) ? b.profiles.filter(isRecord) : [], (r) => ({ network: r.network, username: r.username, website: { url: str(r.url), label: '' } }));
  add('experience', list('work'), (r) => ({
    company: str(r.name) || str(r.company),
    position: r.position,
    location: r.location,
    period: period(r.startDate, r.endDate),
    website: { url: str(r.url), label: '' },
    description: richFrom(r.summary ?? r.description, r.highlights),
  }));
  add('volunteer', list('volunteer'), (r) => ({
    organization: r.organization,
    location: r.location,
    period: period(r.startDate, r.endDate),
    website: { url: str(r.url), label: '' },
    description: richFrom([str(r.position), str(r.summary)].filter(Boolean).join('\n\n'), r.highlights),
  }));
  add('education', list('education'), (r) => ({
    school: r.institution,
    degree: r.studyType,
    area: r.area,
    grade: r.score,
    period: period(r.startDate, r.endDate),
    website: { url: str(r.url), label: '' },
    description: richFrom('', r.courses),
  }));
  add('awards', list('awards'), (r) => ({ title: r.title, awarder: r.awarder, date: str(r.date) ? shortDate(str(r.date)) : '', description: richFrom(r.summary) }));
  add('certifications', list('certificates'), (r) => ({ title: r.name, issuer: r.issuer, date: str(r.date) ? shortDate(str(r.date)) : '', website: { url: str(r.url), label: '' } }));
  add('publications', list('publications'), (r) => ({
    title: r.name,
    publisher: r.publisher,
    date: str(r.releaseDate) ? shortDate(str(r.releaseDate)) : '',
    website: { url: str(r.url), label: '' },
    description: richFrom(r.summary),
  }));
  add('skills', list('skills'), (r) => ({ name: r.name, proficiency: r.level, keywords: strings(r.keywords) }));
  add('languages', list('languages'), (r) => ({ language: r.language, fluency: r.fluency }));
  add('interests', list('interests'), (r) => ({ name: r.name, keywords: strings(r.keywords) }));
  add('references', list('references'), (r) => ({ name: r.name, description: richFrom(r.reference) }));
  add('projects', list('projects'), (r) => ({ name: r.name, period: period(r.startDate, r.endDate), website: { url: str(r.url), label: '' }, description: richFrom(r.description, r.highlights) }));
  return normalise(out);
}

/** Rich text as plain paragraphs and list items, for JSON Resume. */
export function plainParts(html: string): { text: string; items: string[] } {
  const items: string[] = [];
  const withoutLists = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
    items.push(textOf(inner));
    return '';
  });
  const text = textOf(withoutLists.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n'));
  return { text, items: items.filter(Boolean) };
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const splitPeriod = (p: string) => {
  const [a, b] = p.split(/\s+[–—-]\s+/);
  const iso = (s: string | undefined) => {
    if (!s) return undefined;
    const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s.trim());
    if (m) {
      const month = MONTHS.findIndex((x) => x.toLowerCase() === (m[1] as string).toLowerCase());
      if (month >= 0) return `${m[2]}-${String(month + 1).padStart(2, '0')}`;
    }
    const y = /^(\d{4})(?:-(\d{2}))?/.exec(s.trim());
    return y ? (y[2] ? `${y[1]}-${y[2]}` : y[1]) : undefined;
  };
  return { startDate: iso(a), endDate: b && !/present|now|current/i.test(b) ? iso(b) : undefined };
};

const visibleItems = (s: Section) => (s.hidden ? [] : s.items.filter((i) => !i.hidden));
const w = (v: unknown) => website(v).url || undefined;

/** The résumé as JSON Resume 1.0 (jsonresume.org). */
export function toJsonResume(resume: Resume): Record<string, unknown> {
  const s = resume.sections;
  const prune = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  const described = (html: unknown) => plainParts(str(html));
  return prune({
    $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics: prune({
      name: resume.basics.name,
      label: resume.basics.headline,
      image: resume.picture.hidden ? undefined : resume.picture.url || undefined,
      email: resume.basics.email,
      phone: resume.basics.phone,
      url: resume.basics.website.url,
      summary: plainParts(resume.summary.content).text,
      location: resume.basics.location ? { city: resume.basics.location } : undefined,
      profiles: visibleItems(s.profiles).map((i) => prune({ network: str(i.network), username: str(i.username), url: w(i.website) })),
    }),
    work: visibleItems(s.experience).map((i) => {
      const d = described(i.description);
      return prune({ name: str(i.company), position: str(i.position), location: str(i.location), url: w(i.website), ...splitPeriod(str(i.period)), summary: d.text, highlights: d.items });
    }),
    volunteer: visibleItems(s.volunteer).map((i) => {
      const d = described(i.description);
      return prune({ organization: str(i.organization), url: w(i.website), ...splitPeriod(str(i.period)), summary: d.text, highlights: d.items });
    }),
    education: visibleItems(s.education).map((i) =>
      prune({
        institution: str(i.school),
        url: w(i.website),
        area: str(i.area),
        studyType: str(i.degree),
        score: str(i.grade),
        ...splitPeriod(str(i.period)),
        courses: described(i.description).items,
      }),
    ),
    awards: visibleItems(s.awards).map((i) => prune({ title: str(i.title), date: splitPeriod(str(i.date)).startDate, awarder: str(i.awarder), summary: described(i.description).text })),
    certificates: visibleItems(s.certifications).map((i) => prune({ name: str(i.title), date: splitPeriod(str(i.date)).startDate, issuer: str(i.issuer), url: w(i.website) })),
    publications: visibleItems(s.publications).map((i) =>
      prune({ name: str(i.title), publisher: str(i.publisher), releaseDate: splitPeriod(str(i.date)).startDate, url: w(i.website), summary: described(i.description).text }),
    ),
    skills: visibleItems(s.skills).map((i) => prune({ name: str(i.name), level: str(i.proficiency), keywords: strings(i.keywords) })),
    languages: visibleItems(s.languages).map((i) => prune({ language: str(i.language), fluency: str(i.fluency) })),
    interests: visibleItems(s.interests).map((i) => prune({ name: str(i.name), keywords: strings(i.keywords) })),
    references: visibleItems(s.references).map((i) => prune({ name: str(i.name), reference: described(i.description).text })),
    projects: visibleItems(s.projects).map((i) => {
      const d = described(i.description);
      return prune({ name: str(i.name), ...splitPeriod(str(i.period)), description: d.text, highlights: d.items, url: w(i.website) });
    }),
  });
}

/**
 * Opens a résumé file: Reactive Resume 5 (or Benchtop's, which is the same
 * format), Reactive Resume 4, or JSON Resume.
 */
export function readResumeFile(text: string): { resume: Resume; format: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not JSON. Open a Reactive Resume export (JSON) or a JSON Resume file.');
  }
  if (!isRecord(raw)) throw new Error('This file does not hold a résumé.');
  // Some exports wrap the résumé: { data: {...} }.
  const data = isRecord(raw.data) && (isRecord(raw.data.basics) || isRecord(raw.data.sections)) ? raw.data : raw;
  const basics = isRecord(data.basics) ? data.basics : {};
  const sections = isRecord(data.sections) ? data.sections : {};
  if (isRecord(data.metadata) && (isRecord(data.summary) || 'website' in basics)) return { resume: normalise(data), format: 'Reactive Resume' };
  // Reactive Resume 4 kept every section, the summary included, under "sections"; its link was { label, href }.
  if (isRecord(sections.summary) || isRecord(basics.url) || Array.isArray((isRecord(data.metadata) ? data.metadata : {}).layout)) return { resume: fromReactiveV4(data), format: 'Reactive Resume 4' };
  if ('label' in basics || 'name' in basics || Array.isArray(data.work) || Array.isArray(data.education) || Array.isArray(data.skills) || typeof data.$schema === 'string')
    return { resume: fromJsonResume(data), format: 'JSON Resume' };
  throw new Error('This JSON is not a résumé this tool knows (Reactive Resume 4 or 5, or JSON Resume).');
}

export const resumeFile = (resume: Resume) => `${JSON.stringify(resume, null, 2)}\n`;

/* ------------------------------------------------------------ drawing -- */

export interface FontFace {
  readonly family: string;
  readonly weight: string;
  readonly style: 'normal' | 'italic';
  /** A data: URL of the font file. */
  readonly src: string;
}

export interface DrawOptions {
  /** Reduces rich text to safe formatting (paragraphs, lists, emphasis, links). */
  readonly clean: (html: string) => string;
  /** Fonts that travel inside the page (and so inside the PDF). */
  readonly fonts?: readonly FontFace[];
}

/** "rgba(220, 38, 38, 1)" or "#dc2626" → a CSS colour; anything else → the fallback. */
export function cssColour(value: string, fallback: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(v)) return v;
  return fallback;
}

export function hexOf(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(v);
  if (!m) return '#1f6feb';
  return `#${[m[1], m[2], m[3]]
    .map((n) =>
      Math.round(Math.min(255, Number(n)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export const rgbaOf = (hex: string) => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 1)`;
};

const FALLBACK_STACK = (family: string) =>
  /serif|garamond|georgia|times|merriweather|lora|playfair|plex serif|crimson/i.test(family) && !/sans/i.test(family)
    ? 'Georgia, "Times New Roman", "DejaVu Serif", serif'
    : 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "DejaVu Sans", sans-serif';
const fontStack = (family: string) => `"${family.replace(/["\\]/g, '')}", ${FALLBACK_STACK(family)}`;

const linkText = (url: string) => url.replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/$/, '');
const href = (url: string) => (/^(https?:|mailto:|tel:)/i.test(url) ? url : /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(url) ? `mailto:${url}` : /^[\w-]+(\.[\w-]+)+/.test(url) ? `https://${url}` : '');

function link(site: Website | undefined, fallbackText = ''): string {
  if (!site?.url) return '';
  const target = href(site.url);
  const text = escapeHtml(site.label || linkText(site.url) || fallbackText);
  return target ? `<a href="${escapeHtml(target)}">${text}</a>` : `<span>${text}</span>`;
}

function level(value: unknown): string {
  const n = Math.round(num(value, 0, 0, 5));
  if (!n) return '';
  return `<span class="level" role="img" aria-label="${n} of 5">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function keywords(list: unknown): string {
  const words = strings(list).filter((k) => k.trim());
  return words.length ? `<ul class="keywords">${words.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}</ul>` : '';
}

/** One entry: a heading line (lead, period/date at the right), a second line, then details. */
function entry(type: SectionType, item: Item, o: DrawOptions): string {
  const s = (k: string) => escapeHtml(str(item[k]));
  const site = item.website as Website | undefined;
  const about = str(item.description) ? `<div class="rich">${o.clean(str(item.description))}</div>` : '';
  const when = s('period') || s('date');
  const row = (lead: string, sub: string, extra = '') =>
    `<div class="entry-head"><div class="entry-lead">${lead}</div>${when ? `<div class="entry-when">${when}</div>` : ''}</div>${sub ? `<div class="entry-sub">${sub}</div>` : ''}${extra}`;
  const join = (...parts: string[]) => parts.filter(Boolean).join('<span class="sep">, </span>');
  let body = '';
  switch (type) {
    case 'profiles':
      body = `<div class="entry-head"><div class="entry-lead">${s('network')}</div></div><div class="entry-sub">${link(site, str(item.username)) || s('username')}</div>`;
      break;
    case 'experience':
      body = row(join(`<strong>${s('position') || s('company')}</strong>`, s('position') ? s('company') : ''), join(s('location'), link(site)), about);
      break;
    case 'education':
      body = row(`<strong>${s('school')}</strong>`, join(join(s('degree'), s('area')), s('grade'), s('location'), link(site)), about);
      break;
    case 'projects':
      body = row(`<strong>${s('name')}</strong>`, link(site), about);
      break;
    case 'skills':
      body = `<div class="entry-head"><div class="entry-lead"><strong>${s('name')}</strong>${s('proficiency') ? ` <span class="muted">${s('proficiency')}</span>` : ''}</div>${level(item.level)}</div>${keywords(item.keywords)}`;
      break;
    case 'languages':
      body = `<div class="entry-head"><div class="entry-lead"><strong>${s('language')}</strong>${s('fluency') ? ` <span class="muted">${s('fluency')}</span>` : ''}</div>${level(item.level)}</div>`;
      break;
    case 'interests':
      body = `<div class="entry-head"><div class="entry-lead"><strong>${s('name')}</strong></div></div>${keywords(item.keywords)}`;
      break;
    case 'awards':
      body = row(`<strong>${s('title')}</strong>`, join(s('awarder'), link(site)), about);
      break;
    case 'certifications':
      body = row(`<strong>${s('title')}</strong>`, join(s('issuer'), link(site)), about);
      break;
    case 'publications':
      body = row(`<strong>${s('title')}</strong>`, join(s('publisher'), link(site)), about);
      break;
    case 'volunteer':
      body = row(`<strong>${s('organization')}</strong>`, join(s('location'), link(site)), about);
      break;
    case 'references':
      body = row(`<strong>${s('name')}</strong>`, join(s('position'), s('phone'), link(site)), about);
      break;
  }
  return `<div class="entry">${body}</div>`;
}

function sectionHtml(resume: Resume, id: string, o: DrawOptions): string {
  if (id === 'summary') {
    const s = resume.summary;
    if (s.hidden || !s.content.trim()) return '';
    return `<section class="section section-summary">${s.showHeading === false ? '' : `<h2>${escapeHtml(s.title || SECTION_LABELS.summary)}</h2>`}<div class="rich">${o.clean(s.content)}</div></section>`;
  }
  const custom = resume.customSections.find((c) => c.id === id);
  const type: SectionType | null = custom ? (isSectionType(custom.type) ? custom.type : 'projects') : isSectionType(id) ? id : null;
  const section = custom ?? (type ? resume.sections[type] : undefined);
  if (!type || !section || section.hidden) return '';
  const items = section.items.filter((i) => !i.hidden);
  if (!items.length) return '';
  const columns = Math.min(6, Math.max(1, section.columns || 1));
  return `<section class="section section-${type}${section.startOnNewPage ? ' new-page' : ''}${section.keepTogether ? ' together' : ''}">${section.showHeading === false ? '' : `<h2>${escapeHtml(section.title || (custom ? 'Section' : SECTION_LABELS[type]))}</h2>`}<div class="entries" style="--columns:${columns}">${items.map((i) => entry(type, i, o)).join('')}</div></section>`;
}

function contacts(resume: Resume): string {
  const b = resume.basics;
  const parts = [
    b.email ? `<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : '',
    b.phone ? `<a href="tel:${escapeHtml(b.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(b.phone)}</a>` : '',
    b.location ? `<span>${escapeHtml(b.location)}</span>` : '',
    link(b.website),
    ...b.customFields.map((f) => (f.link ? link({ url: f.link, label: f.text }) : f.text ? `<span>${escapeHtml(f.text)}</span>` : '')),
  ].filter(Boolean);
  return parts.length ? `<ul class="contacts">${parts.map((p) => `<li>${p}</li>`).join('')}</ul>` : '';
}

function photo(resume: Resume): string {
  const p = resume.picture;
  if (p.hidden || !p.url.startsWith('data:image/')) return '';
  const width = p.size;
  const height = p.size / (p.aspectRatio || 1);
  return `<img class="photo" alt="" src="${escapeHtml(p.url)}" style="width:${width}pt;height:${height}pt;border-radius:${p.borderRadius}pt;object-fit:${p.fit}${p.borderWidth ? `;border:${p.borderWidth}pt solid ${cssColour(p.borderColor, '#888')}` : ''}${p.rotation ? `;transform:rotate(${p.rotation}deg)` : ''}">`;
}

export const templateOf = (resume: Resume): TemplateId => resume.benchtop?.template ?? 'classic';

/** Page size in millimetres. */
export const PAGE_MM = { a4: [210, 297], letter: [215.9, 279.4] } as const;

export function pageFormat(resume: Resume): 'a4' | 'letter' {
  return resume.metadata.page.format === 'letter' ? 'letter' : 'a4';
}

/** The whole résumé as a self-contained, print-ready HTML page. */
export function resumeHtml(resume: Resume, o: DrawOptions): string {
  const template = templateOf(resume);
  const m = resume.metadata;
  const accent = cssColour(m.design.colors.primary, '#1f6feb');
  const text = cssColour(m.design.colors.text, '#000');
  const paper = cssColour(m.design.colors.background, '#fff');
  const body = m.typography.body;
  const heading = m.typography.heading;
  const format = pageFormat(resume);
  const pages = m.layout.pages.length ? m.layout.pages : emptyResume().metadata.layout.pages;
  const twoColumns = TEMPLATE_INFO[template].columns === 2;
  const pageHtml = pages
    .map((page, index) => {
      const main = page.main.map((id) => sectionHtml(resume, id, o)).join('');
      const side = page.sidebar.map((id) => sectionHtml(resume, id, o)).join('');
      const split = twoColumns && !page.fullWidth && side;
      const content = split ? `<div class="columns"><div class="main">${main}</div><aside class="side">${side}</aside></div>` : `<div class="main">${main}${side}</div>`;
      return `<div class="page${index > 0 ? ' page-break' : ''}">${index === 0 ? header(resume, template) : ''}${content}</div>`;
    })
    .join('');
  const faces = (o.fonts ?? []).map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:url(${f.src}) format("woff2");}`).join('\n');
  const css = `${faces}
@page { size: ${format === 'letter' ? 'letter' : 'A4'}; margin: ${m.page.marginY}pt ${m.page.marginX}pt; }
* { box-sizing: border-box; }
html { background: ${paper}; }
body { margin: 0; color: ${text}; background: ${paper}; font-family: ${fontStack(body.fontFamily)}; font-size: ${body.fontSize}pt; line-height: ${body.lineHeight}; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow-wrap: break-word; }
a { color: inherit; text-decoration: ${m.page.hideLinkUnderline ? 'none' : 'underline'}; text-decoration-color: color-mix(in srgb, ${accent} 60%, transparent); }
h1, h2, h3 { font-family: ${fontStack(heading.fontFamily)}; line-height: ${heading.lineHeight}; margin: 0; }
h1 { font-size: ${heading.fontSize * 1.9}pt; font-weight: 700; letter-spacing: -0.01em; }
h2 { font-size: ${heading.fontSize}pt; font-weight: 600; color: ${accent}; margin: 0 0 4pt; break-after: avoid; }
.headline { font-size: ${body.fontSize * 1.15}pt; margin-top: 2pt; }
.muted, .entry-sub, .entry-when { color: color-mix(in srgb, ${text} 68%, ${paper}); }
.page-break { break-before: page; }
.section { margin-top: ${m.page.gapY * 1.6}pt; }
.section.new-page { break-before: page; }
.section.together { break-inside: avoid; }
.entries { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: ${m.page.gapY}pt ${m.page.gapX * 3}pt; }
.entry { break-inside: avoid; }
.entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8pt; }
.entry-when { flex: none; font-size: 0.92em; text-align: right; }
.entry-sub { font-size: 0.95em; }
.sep { white-space: pre; }
.rich { margin-top: 2pt; }
.rich p { margin: 0 0 3pt; }
.rich ul, .rich ol { margin: 2pt 0 3pt; padding-left: 13pt; }
.rich li { margin: 1pt 0; }
.rich li p { margin: 0; }
.rich mark { background: color-mix(in srgb, ${accent} 22%, transparent); color: inherit; }
.keywords { display: flex; flex-wrap: wrap; gap: 3pt; margin: 3pt 0 0; padding: 0; list-style: none; font-size: 0.9em; }
.keywords li { padding: 0.5pt 5pt; border-radius: 3pt; background: color-mix(in srgb, ${accent} 12%, ${paper}); }
.level { display: inline-flex; gap: 2.5pt; flex: none; }
.level i { width: 6pt; height: 6pt; border-radius: 50%; border: 1pt solid ${accent}; }
.level i.on { background: ${accent}; }
.contacts { display: flex; flex-wrap: wrap; gap: 2pt 12pt; margin: 6pt 0 0; padding: 0; list-style: none; font-size: 0.95em; }
.photo { display: block; flex: none; }
${TEMPLATE_CSS[template](accent, text, paper, m.layout.sidebarWidth)}`;
  return `<!doctype html>
<html lang="${escapeHtml((m.page.locale || 'en').split('-')[0] as string)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Benchtop Resume Builder">
<title>${escapeHtml(resume.basics.name || 'Résumé')}</title>
<style>${css}</style>
</head>
<body class="t-${template}">
${pageHtml}
</body>
</html>
`;
}

function header(resume: Resume, template: TemplateId): string {
  const b = resume.basics;
  const name = `<h1>${escapeHtml(b.name || 'Your name')}</h1>`;
  const headline = b.headline ? `<div class="headline">${escapeHtml(b.headline)}</div>` : '';
  const pic = photo(resume);
  if (template === 'banner') return `<header class="banner"><div class="banner-text">${name}${headline}${contacts(resume)}</div>${pic}</header>`;
  if (template === 'sidebar') return `<header class="top">${pic}<div>${name}${headline}${contacts(resume)}</div></header>`;
  if (template === 'compact') return `<header class="top"><div class="top-text">${name}${headline}</div>${contacts(resume)}${pic}</header>`;
  return `<header class="top">${pic}${name}${headline}${contacts(resume)}</header>`;
}

const TEMPLATE_CSS: Record<TemplateId, (accent: string, text: string, paper: string, sidebar: number) => string> = {
  classic: (accent) => `
.top { display: flex; flex-direction: column; align-items: center; text-align: center; padding-bottom: 8pt; border-bottom: 1.5pt solid ${accent}; }
.top .photo { margin-bottom: 6pt; }
.top .contacts { justify-content: center; }
h2 { font-variant: small-caps; letter-spacing: 0.06em; padding-bottom: 2pt; border-bottom: 0.75pt solid color-mix(in srgb, ${accent} 45%, transparent); }`,
  sidebar: (accent, _text, paper, sidebar) => `
.top { display: flex; gap: 14pt; align-items: center; padding-bottom: 8pt; }
.columns { display: grid; grid-template-columns: ${100 - sidebar}fr ${sidebar}fr; gap: 16pt; align-items: start; }
.side { padding: 4pt 10pt 10pt; border-radius: 6pt; background: color-mix(in srgb, ${accent} 9%, ${paper}); }
.side .section:first-child { margin-top: 6pt; }
h2 { display: flex; align-items: center; gap: 6pt; }
h2::before { content: ""; width: 10pt; height: 3pt; border-radius: 2pt; background: ${accent}; }`,
  banner: (accent, _text, paper, sidebar) => `
.banner { display: flex; justify-content: space-between; align-items: center; gap: 14pt; padding: 14pt 16pt; border-radius: 6pt; background: ${accent}; color: ${paper}; }
.banner a { color: inherit; text-decoration-color: currentColor; }
.banner .headline { opacity: 0.92; }
.banner .photo { border: 2pt solid ${paper}; }
.columns { display: grid; grid-template-columns: ${100 - sidebar}fr ${sidebar}fr; gap: 16pt; align-items: start; }
.side { padding-left: 12pt; border-left: 1pt solid color-mix(in srgb, ${accent} 30%, transparent); }
h2 { text-transform: none; }`,
  compact: (accent) => `
body { font-size: 0.94em; }
.top { display: flex; align-items: flex-end; gap: 12pt; padding-bottom: 6pt; border-bottom: 2pt solid ${accent}; }
.top-text { flex: 1; }
.top .contacts { flex-direction: column; align-items: flex-end; gap: 0; margin: 0; text-align: right; }
.section { display: grid; grid-template-columns: 22% minmax(0, 1fr); gap: 10pt; margin-top: 9pt; }
.section > h2 { font-size: 0.85em; letter-spacing: 0.08em; font-variant: small-caps; padding-top: 1pt; text-align: right; }
.section > .rich, .section > .entries { grid-column: 2; }
.section-summary > .rich { margin-top: 0; }`,
};

/* ------------------------------------------------------------- sample -- */

export function sampleResume(): Resume {
  const r = emptyResume();
  r.basics = {
    ...r.basics,
    name: 'Meera Iyer',
    headline: 'Interactive exhibit developer',
    email: 'meera.iyer@example.com',
    phone: '+91 90000 00000',
    location: 'Bengaluru, India',
    website: { url: 'https://example.com/meera', label: 'example.com/meera' },
  };
  r.summary.content =
    '<p>Exhibit developer who turns physics and engineering ideas into hands-on galleries. Seven years of building interactives that run all day, every day, on open-source software and modest hardware.</p>';
  const add = (type: SectionType, values: Record<string, unknown>[]) => {
    r.sections[type].items = values.map((v) => normaliseItem(type, { ...newItem(type), ...v }));
  };
  add('experience', [
    {
      company: 'Riverside Science Centre',
      position: 'Senior exhibit developer',
      location: 'Bengaluru',
      period: 'Apr 2021 – Present',
      description:
        '<ul><li><p>Led a team of four building a 40-exhibit gallery on energy, opened on time and on budget.</p></li><li><p>Moved every kiosk to Linux and open-source software, cutting licence costs to zero.</p></li><li><p>Designed exhibits with visually impaired visitors, adding audio and tactile versions.</p></li></ul>',
    },
    {
      company: 'Lumen Labs',
      position: 'Creative technologist',
      location: 'Pune',
      period: 'Jul 2018 – Mar 2021',
      description:
        '<ul><li><p>Built projection-mapped and sensor-driven installations for museums and festivals.</p></li><li><p>Wrote the shared toolkit (Godot, Python) the studio still uses for kiosks.</p></li></ul>',
    },
  ]);
  add('education', [{ school: 'Southern Institute of Technology', degree: 'B.Tech.', area: 'Electronics and communication', period: '2014 – 2018', grade: 'First class with distinction' }]);
  add('projects', [
    {
      name: 'Pendulum wave wall',
      period: '2024',
      website: { url: 'https://example.com/pendulums', label: '' },
      description: '<p>Fifteen pendulums of carefully chosen lengths that drift in and out of step, with a slow-motion camera visitors can scrub.</p>',
    },
  ]);
  add('skills', [
    { name: 'Exhibit engineering', level: 5, keywords: ['Arduino', 'ESP32', 'Raspberry Pi', 'Sensors'] },
    { name: 'Software', level: 4, keywords: ['Godot', 'Python', 'TypeScript', 'Linux'] },
    { name: 'Design', level: 4, keywords: ['Accessibility', 'Prototyping', 'Visitor studies'] },
  ]);
  add('languages', [
    { language: 'English', fluency: 'Fluent', level: 5 },
    { language: 'Kannada', fluency: 'Native', level: 5 },
    { language: 'Hindi', fluency: 'Conversational', level: 3 },
  ]);
  add('certifications', [{ title: 'Accessible exhibit design', issuer: 'Museum Access Forum', date: 'Nov 2023' }]);
  add('profiles', [{ network: 'GitHub', username: 'meera-builds', website: { url: 'https://github.com/meera-builds', label: '' } }]);
  r.benchtop = { template: 'sidebar' };
  return normalise(r);
}
