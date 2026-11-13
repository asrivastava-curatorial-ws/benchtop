/** Lets the user provide an image by dropping, choosing or pasting it. */
import { useEffect, useState } from 'preact/hooks';
import { formatBytes } from '../lib/bytes';
import { pickFile } from '../platform';
import { loadImage } from './canvas';
import { Icon } from './icons';
import { attempt } from './toast';

export interface LoadedImage {
  readonly canvas: HTMLCanvasElement;
  readonly name: string;
  readonly type: string;
  /** Size of the original file in bytes. */
  readonly size: number;
  readonly file: Blob;
}

const MAX_IMAGE_FILE = 100 * 1024 * 1024;

export async function loadImageFile(file: File | Blob, name = 'image'): Promise<LoadedImage> {
  if (file.size > MAX_IMAGE_FILE) throw new Error('That image file is larger than 100 MB.');
  const canvas = await loadImage(file);
  return { canvas, name: file instanceof File ? file.name : name, type: file.type, size: file.size, file };
}

interface Props {
  readonly image: LoadedImage | null;
  readonly onImage: (image: LoadedImage | null) => void;
  readonly accept?: string;
  readonly hint?: string;
}

export function ImageDrop({ image, onImage, accept = 'image/*,.svg,.ico,.avif', hint }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const take = (file: File | Blob | null | undefined) => {
    if (!file) return;
    setLoading(true);
    void attempt(async () => onImage(await loadImageFile(file))).finally(() => setLoading(false));
  };

  // Images copied to the clipboard can be pasted anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        take(file);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onImage]);

  const choose = () => attempt(async () => take(await pickFile(accept)));
  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) {
        event.preventDefault();
        take(file);
      }
    },
  };

  if (image) {
    return (
      <div class={`image-source${dragging ? ' is-dragging' : ''}`} {...dropHandlers} data-testid="image-source">
        <Icon name="image" size={18} />
        <div class="image-source-text">
          <div class="file-name">{image.name}</div>
          <div class="file-meta">
            {image.canvas.width} × {image.canvas.height} px, {formatBytes(image.size)}
          </div>
        </div>
        <button type="button" class="button button-small" onClick={choose}>
          Replace
        </button>
        <button type="button" class="button button-small button-quiet" onClick={() => onImage(null)}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <button type="button" class={`dropzone${dragging ? ' is-dragging' : ''}`} onClick={choose} {...dropHandlers} data-testid="dropzone" disabled={loading}>
      <Icon name="image" size={30} />
      <span class="dropzone-title">{loading ? 'Reading image…' : 'Drop an image here, or click to choose one'}</span>
      <span class="dropzone-hint">{hint ?? 'You can also paste an image from the clipboard. Nothing leaves this computer.'}</span>
    </button>
  );
}
