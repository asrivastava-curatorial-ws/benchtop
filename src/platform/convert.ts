/**
 * Converters in the desktop shell (convert.rs).  They run programs already
 * installed on this computer (FFmpeg, LibreOffice, Pandoc, ImageMagick,
 * Inkscape, Calibre, qpdf, Ghostscript) on files chosen in the native dialog,
 * and write the results next to the originals or wherever the user chooses.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export type ProgramId = 'ffmpeg' | 'ffprobe' | 'libreoffice' | 'pandoc' | 'imagemagick' | 'inkscape' | 'calibre' | 'qpdf' | 'ghostscript' | 'espeak';

export interface Programs {
  readonly programs: Readonly<Record<ProgramId, string | null>>;
  readonly os: 'linux' | 'macos' | 'windows' | string;
}

export interface MediaInfo {
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly audio: boolean;
  readonly video: boolean;
}

/** Where results go: a Save dialog per file, next to the original, or a folder chosen once. */
export type Destination = 'ask' | 'beside' | 'folder';

export interface ConvertJob {
  /** Any unique id; progress events and Stop use it. */
  readonly id: string;
  readonly recipe: string;
  /** Tokens from pickPaths(); the first is the main input. */
  readonly inputs: readonly string[];
  readonly options?: Record<string, unknown>;
  readonly destination: Destination;
  /** Folder token from pickFolder() when destination is 'folder'. */
  readonly folder?: string;
}

export interface ConvertResult {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  /** Token for revealResult(). */
  readonly token: string;
}

export interface ConvertProgress {
  readonly id: string;
  readonly fraction: number;
}

export class NeedsDesktop extends Error {
  constructor(what = 'This tool') {
    super(`${what} runs programs installed on this computer, which needs the Benchtop desktop app.`);
    this.name = 'NeedsDesktop';
  }
}

const need = (what?: string) => {
  if (!isDesktop) throw new NeedsDesktop(what);
};

let cached: Promise<Programs> | null = null;

/** Which converters are installed (looked up once; pass `fresh` after installing one). */
export function findPrograms(fresh = false): Promise<Programs> {
  need('Converting files');
  if (fresh || !cached) {
    cached = invoke<Programs>('convert_programs').catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export async function probeMedia(token: string): Promise<MediaInfo> {
  need();
  return invoke<MediaInfo>('convert_probe', { token });
}

/** ffprobe's full report (format, streams, chapters) for a chosen file. */
export async function mediaReport(token: string): Promise<Record<string, unknown>> {
  need('Media Info');
  return invoke<Record<string, unknown>>('convert_media_info', { token });
}

/** One frame of a chosen video, as a PNG data URL at most `width` pixels wide (trim and crop previews). */
export async function videoFrame(token: string, seconds: number, width = 960): Promise<string> {
  need();
  return `data:image/png;base64,${await invoke<string>('convert_frame', { token, seconds, width })}`;
}

/** Runs one job.  Resolves with null when the Save dialog was cancelled. */
export async function runConversion(job: ConvertJob): Promise<ConvertResult | null> {
  need('Converting files');
  const result = await invoke<ConvertResult | { cancelled: true }>('convert_run', { job });
  return 'cancelled' in result ? null : result;
}

export async function stopConversion(id: string): Promise<void> {
  if (isDesktop) await invoke('convert_cancel', { id });
}

export async function pickFolder(): Promise<{ token: string; path: string } | null> {
  need();
  return invoke('convert_pick_folder');
}

export async function revealResult(token: string): Promise<void> {
  if (isDesktop) await invoke('convert_reveal', { token });
}

export function onConvertProgress(handler: (progress: ConvertProgress) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<ConvertProgress>('convert-progress', (event) => handler(event.payload));
}

export interface ProgramInfo {
  readonly name: string;
  readonly use: string;
  readonly homepage: string;
  readonly licence: string;
  /** Install commands by operating system. */
  readonly install: Readonly<Record<'debian' | 'fedora' | 'arch' | 'macos' | 'windows', string>>;
}

/** Install hints.  Every program here is free and open source. */
export const PROGRAMS: Readonly<Record<Exclude<ProgramId, 'ffprobe'>, ProgramInfo>> = {
  espeak: {
    name: 'eSpeak NG',
    use: 'speech sounds for the Piper voices',
    homepage: 'https://github.com/espeak-ng/espeak-ng',
    licence: 'GPL-3.0',
    install: {
      debian: 'sudo apt install espeak-ng',
      fedora: 'sudo dnf install espeak-ng',
      arch: 'sudo pacman -S espeak-ng',
      macos: 'brew install espeak-ng',
      windows: 'Download espeak-ng.msi from github.com/espeak-ng/espeak-ng/releases',
    },
  },
  ffmpeg: {
    name: 'FFmpeg',
    use: 'video and audio',
    homepage: 'https://ffmpeg.org',
    licence: 'LGPL/GPL',
    install: { debian: 'sudo apt install ffmpeg', fedora: 'sudo dnf install ffmpeg-free', arch: 'sudo pacman -S ffmpeg', macos: 'brew install ffmpeg', windows: 'winget install --id Gyan.FFmpeg -e' },
  },
  libreoffice: {
    name: 'LibreOffice',
    use: 'Word, Excel, PowerPoint and OpenDocument files',
    homepage: 'https://www.libreoffice.org',
    licence: 'MPL-2.0',
    install: {
      debian: 'sudo apt install libreoffice',
      fedora: 'sudo dnf install libreoffice',
      arch: 'sudo pacman -S libreoffice-fresh',
      macos: 'brew install --cask libreoffice',
      windows: 'winget install --id TheDocumentFoundation.LibreOffice -e',
    },
  },
  pandoc: {
    name: 'Pandoc',
    use: 'Markdown, HTML, reStructuredText, LaTeX, EPUB and more',
    homepage: 'https://pandoc.org',
    licence: 'GPL-2.0',
    install: {
      debian: 'sudo apt install pandoc',
      fedora: 'sudo dnf install pandoc',
      arch: 'sudo pacman -S pandoc-cli',
      macos: 'brew install pandoc',
      windows: 'winget install --id JohnMacFarlane.Pandoc -e',
    },
  },
  imagemagick: {
    name: 'ImageMagick',
    use: 'HEIC, AVIF, TIFF, PSD, ICO and other pictures',
    homepage: 'https://imagemagick.org',
    licence: 'ImageMagick (Apache-2.0 style)',
    install: {
      debian: 'sudo apt install imagemagick',
      fedora: 'sudo dnf install ImageMagick',
      arch: 'sudo pacman -S imagemagick',
      macos: 'brew install imagemagick',
      windows: 'winget install --id ImageMagick.ImageMagick -e',
    },
  },
  inkscape: {
    name: 'Inkscape',
    use: 'SVG, EPS and EMF drawings',
    homepage: 'https://inkscape.org',
    licence: 'GPL-2.0+',
    install: {
      debian: 'sudo apt install inkscape',
      fedora: 'sudo dnf install inkscape',
      arch: 'sudo pacman -S inkscape',
      macos: 'brew install --cask inkscape',
      windows: 'winget install --id Inkscape.Inkscape -e',
    },
  },
  calibre: {
    name: 'Calibre',
    use: 'e-books (EPUB, MOBI, AZW3, FB2)',
    homepage: 'https://calibre-ebook.com',
    licence: 'GPL-3.0',
    install: {
      debian: 'sudo apt install calibre',
      fedora: 'sudo dnf install calibre',
      arch: 'sudo pacman -S calibre',
      macos: 'brew install --cask calibre',
      windows: 'winget install --id calibre.calibre -e',
    },
  },
  qpdf: {
    name: 'qpdf',
    use: 'PDF passwords and optimisation',
    homepage: 'https://qpdf.sourceforge.io',
    licence: 'Apache-2.0',
    install: { debian: 'sudo apt install qpdf', fedora: 'sudo dnf install qpdf', arch: 'sudo pacman -S qpdf', macos: 'brew install qpdf', windows: 'winget install --id QPDF.QPDF -e' },
  },
  ghostscript: {
    name: 'Ghostscript',
    use: 'shrinking PDFs',
    homepage: 'https://www.ghostscript.com',
    licence: 'AGPL-3.0',
    install: {
      debian: 'sudo apt install ghostscript',
      fedora: 'sudo dnf install ghostscript',
      arch: 'sudo pacman -S ghostscript',
      macos: 'brew install ghostscript',
      windows: 'winget install --id ArtifexSoftware.GhostScript -e',
    },
  },
};
