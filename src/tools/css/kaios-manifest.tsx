import { strToU8, zipSync } from 'fflate';
import { type AppInfo, CATEGORIES, checkApp, type Locale, manifestWebapp, manifestWebmanifest, PERMISSIONS, type Permission } from '../../lib/kaios-manifest';
import { defineVisualTool, type Values } from '../types';
import { color } from './_shared';

const LOCALE = [
  { key: 'locale', label: 'Locale', type: 'text', default: 'hi-IN', mono: true },
  { key: 'name', label: 'Name', type: 'text', default: 'संग्रहालय गाइड' },
  { key: 'subtitle', label: 'Subtitle', type: 'text', default: '' },
  { key: 'description', label: 'Description', type: 'text', default: '' },
] as const;

const PERMISSION = [
  { key: 'name', label: 'Permission', type: 'select', choices: PERMISSIONS.map((p) => ({ value: p.name, label: p.privileged ? `${p.name} (privileged)` : p.name })), default: 'geolocation' },
  { key: 'description', label: 'Why the app needs it', type: 'text', default: '' },
  {
    key: 'access',
    label: 'Access',
    type: 'select',
    choices: ['readonly', 'readwrite', 'readcreate', 'createonly'],
    default: 'readonly',
    showIf: (v: Values) => String(v.name).startsWith('device-storage:'),
  },
] as const;

const controls = [
  { key: 'name', label: 'App name', type: 'text', default: 'Museum Guide', wide: true, help: 'Up to 20 characters show in the KaiStore.' },
  { key: 'shortName', label: 'Short name (KaiOS 3)', type: 'text', default: 'Museum', help: 'Under the icon; up to 12 characters.' },
  { key: 'subtitle', label: 'Subtitle', type: 'text', default: 'Galleries, maps and audio tours', wide: true, help: 'Up to 40 characters.' },
  {
    key: 'description',
    label: 'Description',
    type: 'text',
    multiline: true,
    default: 'Find your way around the galleries, hear the stories behind the exhibits and plan your visit, even without a data connection.',
    wide: true,
  },
  { key: 'version', label: 'Version', type: 'text', default: '1.0.0', mono: true },
  { key: 'category', label: 'Category', type: 'select', choices: CATEGORIES.map((c) => ({ value: c, label: c[0]?.toUpperCase() + c.slice(1) })), default: 'utilities' },
  { key: 'developer', label: 'Developer', type: 'text', default: 'VITM Bengaluru' },
  { key: 'developerUrl', label: 'Developer website', type: 'text', default: 'https://example.org', mono: true },
  { key: 'heading-app', label: 'App', type: 'heading' },
  {
    key: 'type',
    label: 'Type',
    type: 'segmented',
    choices: [
      { value: 'web', label: 'Web' },
      { value: 'privileged', label: 'Privileged' },
    ],
    default: 'web',
  },
  { key: 'origin', label: 'Origin', type: 'text', default: 'app://museumguide.example.org', mono: true, showIf: (v: Values) => v.type === 'privileged' },
  {
    key: 'id',
    label: 'App id (KaiOS 3)',
    type: 'text',
    default: '',
    placeholder: 'Same as the name',
    mono: true,
    help: 'The KaiStore builds the update address from it; keep it the same between versions.',
  },
  { key: 'launchPath', label: 'Start page', type: 'text', default: '/index.html', mono: true },
  { key: 'iconPath', label: 'Icons folder', type: 'text', default: '/icons', mono: true, help: 'icon-56.png and icon-112.png, as App Icon Maker saves them.' },
  { key: 'orientation', label: 'Orientation', type: 'select', choices: ['portrait', 'landscape', 'natural'], default: 'portrait' },
  { key: 'themeColor', label: 'Theme colour', type: 'color', default: '#17694e' },
  { key: 'backgroundColor', label: 'Background colour', type: 'color', default: '#ffffff' },
  { key: 'fullscreen', label: 'Full screen', type: 'toggle', default: false },
  { key: 'overlap', label: 'Draw under the status bar', type: 'toggle', default: false, showIf: (v: Values) => v.fullscreen === true },
  { key: 'cursor', label: 'Show a cursor (KaiOS 2.5)', type: 'toggle', default: false, help: 'For web pages built for touch or a mouse; moves with the arrow keys.' },
  { key: 'defaultLocale', label: 'Main language', type: 'text', default: 'en-US', mono: true },
  {
    key: 'locales',
    label: 'Other languages',
    type: 'list',
    item: LOCALE,
    min: 0,
    max: 8,
    itemLabel: 'Language',
    default: [{ locale: 'hi-IN', name: 'संग्रहालय गाइड', subtitle: 'दीर्घाएँ, नक्शे और ऑडियो टूर', description: '' }],
  },
  {
    key: 'permissions',
    label: 'Permissions',
    type: 'list',
    item: PERMISSION,
    min: 0,
    max: 16,
    itemLabel: 'Permission',
    default: [{ name: 'geolocation', description: 'Shows where you are in the museum', access: 'readonly' }],
  },
] as const;

const trimTo = (text: string, max: number) => ([...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text);

export default defineVisualTool({
  controls,
  render(v) {
    const app: AppInfo = {
      name: v.name,
      shortName: v.shortName,
      subtitle: v.subtitle,
      description: v.description,
      version: v.version,
      id: v.id,
      type: v.type as AppInfo['type'],
      origin: v.origin,
      launchPath: v.launchPath,
      developer: v.developer,
      developerUrl: v.developerUrl,
      category: v.category,
      defaultLocale: v.defaultLocale.trim() || 'en-US',
      locales: (v.locales as unknown as Locale[]).map((l) => ({ locale: String(l.locale).trim(), name: String(l.name), subtitle: String(l.subtitle), description: String(l.description) })),
      orientation: v.orientation,
      themeColor: v.themeColor,
      backgroundColor: v.backgroundColor,
      fullscreen: v.fullscreen,
      overlapStatusBar: v.overlap,
      cursor: v.cursor,
      permissions: (v.permissions as unknown as Permission[]).map((p) => ({ name: String(p.name), description: String(p.description), access: String(p.access) })),
      iconPath: v.iconPath.trim() || '/icons',
    };
    const problems = checkApp(app);
    const webapp = manifestWebapp(app);
    const webmanifest = manifestWebmanifest(app);
    const localeFiles = [
      { locale: app.defaultLocale, name: app.name, subtitle: app.subtitle, description: app.description },
      ...app.locales.filter((l) => l.locale && l.locale !== app.defaultLocale),
    ].map((l) => ({
      file: `manifest.${l.locale}.webmanifest`,
      code: manifestWebmanifest(app, l),
    }));
    const theme = color(v.themeColor);
    const landscape = v.orientation === 'landscape';
    const initial = [...(app.name.trim() || '?')][0]?.toUpperCase() ?? '?';
    return {
      preview: (
        <div class="kai-stage">
          <div class={`kai-phone${landscape ? ' is-landscape' : ''}`} aria-label="App on a KaiOS phone" role="img">
            {!app.fullscreen || app.overlapStatusBar ? (
              <div class="kai-status" style={{ background: app.fullscreen && app.overlapStatusBar ? 'transparent' : theme }}>
                <span>12:30</span>
                <span>▮▮▮ 4G</span>
              </div>
            ) : null}
            <div class="kai-header" style={{ background: theme }}>
              {trimTo(app.name || 'App', 20)}
            </div>
            <div class="kai-body" style={{ background: color(v.backgroundColor) }}>
              <div class="kai-item is-focused" style={{ background: theme }}>
                Galleries
              </div>
              <div class="kai-item">Map</div>
              <div class="kai-item">Audio tours</div>
              <div class="kai-item">Plan a visit</div>
            </div>
            <div class="kai-softkeys">
              <span>Options</span>
              <strong>SELECT</strong>
              <span>Back</span>
            </div>
          </div>
          <div class="kai-store" aria-label="KaiStore listing" role="img">
            <span class="kai-icon" style={{ background: theme }}>
              {initial}
            </span>
            <span class="kai-store-text">
              <strong>{trimTo(app.name || 'App', 20)}</strong>
              <span>{trimTo(app.subtitle, 40)}</span>
              <small>
                {app.category} · {app.developer}
              </small>
            </span>
          </div>
        </div>
      ),
      css: `.kai-stage { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; justify-content: center; padding: 18px; font-family: "Open Sans", system-ui, sans-serif; }
.kai-phone { display: grid; grid-template-rows: auto auto 1fr auto; width: 240px; height: 320px; overflow: hidden; border: 10px solid #1f2328; border-radius: 18px; background: #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 0.3); box-sizing: content-box; }
.kai-phone.is-landscape { width: 320px; height: 240px; }
.kai-status { filter: brightness(0.8); display: flex; justify-content: space-between; height: 26px; padding: 0 8px; color: #fff; font-size: 12px; line-height: 26px; }
.kai-header { filter: brightness(0.8); height: 28px; padding: 0 10px; color: #fff; font-size: 17px; line-height: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kai-body { overflow: hidden; }
.kai-item { height: 40px; padding: 0 10px; border-bottom: 1px solid #e0e0e0; color: #323232; font-size: 15px; line-height: 40px; }
.kai-item.is-focused { color: #fff; }
.kai-softkeys { display: flex; align-items: center; justify-content: space-between; height: 30px; padding: 0 8px; background: #cccccc; color: #323232; font-size: 13px; }
.kai-softkeys strong { font-size: 13px; letter-spacing: 0.02em; }
.kai-store { display: flex; gap: 12px; align-items: center; width: 260px; padding: 12px; border-radius: 10px; background: #fff; color: #222; box-shadow: 0 4px 14px rgb(0 0 0 / 0.15); }
.kai-icon { display: grid; place-items: center; flex: none; width: 56px; height: 56px; border-radius: 50%; color: #fff; font-size: 26px; font-weight: 700; box-shadow: 0 2px 4px rgb(0 0 0 / 0.3); }
.kai-store-text { display: grid; gap: 2px; min-width: 0; }
.kai-store-text strong { font-size: 15px; }
.kai-store-text span { color: #444; font-size: 12.5px; }
.kai-store-text small { color: #555; font-size: 11.5px; text-transform: capitalize; }`,
      outputs: [
        { label: 'KaiOS 2.5', language: 'json', code: webapp, filename: 'manifest.webapp' },
        { label: 'KaiOS 3', language: 'json', code: webmanifest, filename: 'manifest.webmanifest' },
        ...localeFiles.map((f) => ({ label: `KaiOS 3 · ${f.file.replace(/^manifest\.|\.webmanifest$/g, '')}`, language: 'json' as const, code: f.code, filename: f.file })),
      ],
      downloads: [
        {
          label: 'All (ZIP)',
          filename: 'kaios-manifests.zip',
          make: () =>
            zipSync({
              'kaios-2.5/manifest.webapp': strToU8(webapp),
              'kaios-3/manifest.webmanifest': strToU8(webmanifest),
              ...Object.fromEntries(localeFiles.map((f) => [`kaios-3/${f.file}`, strToU8(f.code)])),
            }),
        },
      ],
      note: problems.length ? problems.join(' ') : 'Ready for the KaiStore checks: name, subtitle, version and permissions look right.',
    };
  },
});
