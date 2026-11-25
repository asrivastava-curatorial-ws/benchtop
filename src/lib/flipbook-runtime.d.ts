/** Types of flipbook-runtime.js (plain JavaScript, so exported flipbooks can carry it). */

export type FlipAction =
  | { readonly kind: 'link'; readonly url: string }
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'video' | 'audio'; readonly media: string; readonly title?: string }
  | { readonly kind: 'note'; readonly title: string; readonly text: string };

export interface FlipHotspot {
  readonly id?: string;
  /** Place and size as fractions of the page. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label?: string;
  readonly action: FlipAction;
}

export interface FlipPageData {
  /** The page's picture; empty for blank pages, or until deps.loadPage brings it. */
  src: string | null;
  /** Words on the page, for search. */
  text?: string;
  /** Colour of a blank page. */
  color?: string;
  readonly hotspots?: readonly FlipHotspot[];
}

export interface FlipSettings {
  readonly spread?: 'double' | 'single';
  readonly rtl?: boolean;
  readonly hardCovers?: boolean;
  /** The first page alone, like a closed book. */
  readonly cover?: boolean;
  readonly background?: string;
  readonly backgroundImage?: string | null;
  readonly sound?: boolean;
  /** Seconds between pages turning by themselves (0: never). */
  readonly autoFlip?: number;
  /** Seconds without a touch before going back to the start (0: never). */
  readonly idleReset?: number;
  /** Milliseconds a page takes to turn. */
  readonly flipTime?: number;
  readonly pageNumbers?: boolean;
}

export interface FlipBookData {
  readonly title: string;
  /** Page size in pixels (only the proportion matters). */
  readonly width: number;
  readonly height: number;
  readonly pages: FlipPageData[];
  readonly contents?: readonly { readonly title: string; readonly page: number }[];
  readonly settings: FlipSettings;
  readonly media?: Readonly<Record<string, { readonly url: string; readonly type: string }>>;
}

export interface FlipDeps {
  /** StPageFlip's PageFlip class. */
  readonly PageFlip: unknown;
  readonly loadPage?: (index: number) => Promise<string | null> | string | null;
  readonly openLink?: (url: string) => void;
  readonly startPage?: number;
  readonly onPage?: (page: number) => void;
}

export interface FlipController {
  next(): void;
  previous(): void;
  /** Opens a page (from 0, in reading order). */
  goTo(index: number): void;
  /** The first page in view (from 0). */
  current(): number;
  visible(): number[];
  destroy(): void;
}

export function mountFlipbook(root: HTMLElement, book: FlipBookData, deps: FlipDeps): FlipController;
export function spreadOf(index: number, count: number, cover: boolean, landscape: boolean): number[];
export function findText(texts: readonly string[], query: string): { page: number; before: string; match: string; after: string }[];
export function describeAction(action: FlipAction | undefined): string;
