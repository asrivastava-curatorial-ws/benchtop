/**
 * KaiOS app manifests: manifest.webapp for KaiOS 2.5 and the PWA-style
 * manifest.webmanifest (with b2g_features) for KaiOS 3.0 and later.
 */

export const CATEGORIES = ['social', 'games', 'utilities', 'life style', 'entertainment', 'health', 'sports', 'book/reference', 'shopping'] as const;

/** Permissions most apps ask for; the ones marked privileged need "type": "privileged". */
export const PERMISSIONS: readonly { readonly name: string; readonly privileged: boolean; readonly access?: boolean }[] = [
  { name: 'geolocation', privileged: false },
  { name: 'desktop-notification', privileged: false },
  { name: 'alarms', privileged: false },
  { name: 'push', privileged: false },
  { name: 'audio-channel-content', privileged: false },
  { name: 'mobiledata', privileged: false },
  { name: 'wifidata', privileged: false },
  { name: 'systemXHR', privileged: true },
  { name: 'tcp-socket', privileged: true },
  { name: 'camera', privileged: true },
  { name: 'audio-capture', privileged: true },
  { name: 'video-capture', privileged: true },
  { name: 'spatialnavigation-app-manage', privileged: true },
  { name: 'flashlight', privileged: true },
  { name: 'device-storage:pictures', privileged: true, access: true },
  { name: 'device-storage:music', privileged: true, access: true },
  { name: 'device-storage:videos', privileged: true, access: true },
  { name: 'device-storage:sdcard', privileged: true, access: true },
];

export interface Permission {
  readonly name: string;
  readonly description: string;
  readonly access: string;
}

export interface Locale {
  readonly locale: string;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
}

export interface AppInfo {
  readonly name: string;
  readonly shortName: string;
  readonly subtitle: string;
  readonly description: string;
  readonly version: string;
  readonly id: string;
  readonly type: 'web' | 'privileged' | 'certified';
  readonly origin: string;
  readonly launchPath: string;
  readonly developer: string;
  readonly developerUrl: string;
  readonly category: string;
  readonly defaultLocale: string;
  readonly locales: readonly Locale[];
  readonly orientation: string;
  readonly themeColor: string;
  readonly backgroundColor: string;
  readonly fullscreen: boolean;
  readonly overlapStatusBar: boolean;
  readonly cursor: boolean;
  readonly permissions: readonly Permission[];
  readonly iconPath: string;
}

export function checkApp(app: AppInfo): string[] {
  const out: string[] = [];
  if (!app.name.trim()) out.push('The name is required.');
  if ([...app.name].length > 20) out.push(`The KaiStore shows at most 20 characters of the name; this one has ${[...app.name].length}.`);
  if ([...app.shortName].length > 12) out.push(`KaiOS 3.0 asks for a short name of 12 characters or fewer; this one has ${[...app.shortName].length}.`);
  if ([...app.subtitle].length > 40) out.push(`Keep the subtitle to 40 characters; this one has ${[...app.subtitle].length}.`);
  if (!/^\d+\.\d+\.\d+$/.test(app.version.trim())) out.push('Use a version with three numbers, such as 1.0.0; the store compares versions number by number.');
  if (!app.developer.trim()) out.push('The developer name is required.');
  if (!app.description.trim()) out.push('Add a description; the KaiStore shows it on the app page.');
  if (!app.launchPath.startsWith('/')) out.push('The launch path should start with /, for example /index.html.');
  if (app.type === 'privileged' && !/^app:\/\/[a-z0-9.-]+$/i.test(app.origin.trim())) out.push('Privileged apps need an origin such as app://museumguide.example.org.');
  if (app.type === 'web') {
    const needs = app.permissions.filter((p) => PERMISSIONS.find((x) => x.name === p.name)?.privileged).map((p) => p.name);
    if (needs.length) out.push(`${needs.join(', ')} ${needs.length === 1 ? 'needs' : 'need'} a privileged app; change the type or remove ${needs.length === 1 ? 'it' : 'them'}.`);
  }
  if (app.type === 'certified') out.push('Certified apps are for KaiOS itself and phone makers; the KaiStore accepts web and privileged apps.');
  const seen = new Set<string>();
  for (const l of app.locales) {
    if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(l.locale)) out.push(`"${l.locale}" is not a locale code such as hi-IN.`);
    if (seen.has(l.locale)) out.push(`The locale ${l.locale} is listed twice.`);
    seen.add(l.locale);
    if ([...l.name].length > 20) out.push(`The ${l.locale} name is longer than 20 characters.`);
  }
  return out;
}

const iconFile = (path: string, size: number) => `${path.replace(/\/+$/, '')}/icon-${size}.png`;

function permissionsObject(list: readonly Permission[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const p of list) {
    if (!p.name.trim()) continue;
    const entry: Record<string, string> = {};
    if (p.description.trim()) entry.description = p.description.trim();
    if (p.name.startsWith('device-storage:')) entry.access = p.access || 'readonly';
    out[p.name.trim()] = entry;
  }
  return out;
}

function localeTable(app: AppInfo): Record<string, Record<string, string>> {
  const all: Locale[] = [{ locale: app.defaultLocale, name: app.name, subtitle: app.subtitle, description: app.description }, ...app.locales.filter((l) => l.locale !== app.defaultLocale)];
  const out: Record<string, Record<string, string>> = {};
  for (const l of all) {
    const entry: Record<string, string> = { name: l.name || app.name };
    if (l.subtitle || app.subtitle) entry.subtitle = l.subtitle || app.subtitle;
    if (l.description || app.description) entry.description = l.description || app.description;
    out[l.locale] = entry;
  }
  return out;
}

/** KaiOS 2.5 manifest.webapp. */
export function manifestWebapp(app: AppInfo): string {
  const manifest: Record<string, unknown> = {
    version: app.version.trim(),
    name: app.name.trim(),
    subtitle: app.subtitle.trim(),
    description: app.description.trim(),
    launch_path: app.launchPath.trim() || '/index.html',
    type: app.type,
    ...(app.type !== 'web' && app.origin.trim() ? { origin: app.origin.trim() } : {}),
    icons: { 56: iconFile(app.iconPath, 56), 112: iconFile(app.iconPath, 112) },
    developer: { name: app.developer.trim(), ...(app.developerUrl.trim() ? { url: app.developerUrl.trim() } : {}) },
    locales: localeTable(app),
    default_locale: app.defaultLocale,
    categories: [app.category],
    orientation: app.orientation,
    theme_color: app.themeColor,
    background_color: app.backgroundColor,
    fullscreen: app.fullscreen,
    ...(app.fullscreen && app.overlapStatusBar ? { chrome: { statusbar: 'overlap' } } : {}),
    cursor: app.cursor,
    permissions: permissionsObject(app.permissions),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** KaiOS 3.0 manifest.webmanifest (PWA format); fields with no PWA equivalent go in b2g_features. */
export function manifestWebmanifest(app: AppInfo, locale?: Locale): string {
  const name = (locale?.name || app.name).trim();
  const short = (app.shortName || app.name).trim();
  const manifest: Record<string, unknown> = {
    lang: locale?.locale ?? app.defaultLocale,
    id: app.id.trim() || app.name.trim(),
    name,
    short_name: locale?.name ? [...locale.name.trim()].slice(0, 12).join('') : short,
    description: (locale?.description || app.description).trim(),
    categories: [app.category],
    icons: [56, 112].map((size) => ({ src: iconFile(app.iconPath, size), type: 'image/png', sizes: `${size}x${size}` })),
    start_url: app.launchPath.trim() || '/index.html',
    display: app.fullscreen ? 'fullscreen' : 'standalone',
    orientation: app.orientation,
    theme_color: app.themeColor,
    background_color: app.backgroundColor,
    b2g_features: {
      version: app.version.trim(),
      subtitle: (locale?.subtitle || app.subtitle).trim(),
      ...(app.type !== 'web' && app.origin.trim() ? { origin: app.origin.trim() } : {}),
      developer: { name: app.developer.trim(), ...(app.developerUrl.trim() ? { url: app.developerUrl.trim() } : {}) },
      permissions: permissionsObject(app.permissions),
      ...(app.fullscreen && app.overlapStatusBar ? { chrome: { statusbar: 'overlap' } } : {}),
      focus_color: app.themeColor,
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
