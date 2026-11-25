/**
 * Animation Studio: motion design with Theatre.js.  Shapes, text, pictures
 * and SVG layers on a stage, in groups if you like; any prop can be keyframed
 * on a timeline with easing, objects can travel along motion paths, clips
 * nest one timeline inside another, and a soundtrack plays in step.
 * Playback runs on @theatre/core.  Projects save as Theatre.js state (for
 * `getProject(name, { state })` in your own code), as the editor's own file,
 * as a web page that plays the animation offline, or as video.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type AnimObject,
  type AnimProject,
  addClip,
  addObject,
  animate,
  animationHtml,
  asClip,
  type Curve,
  childrenOf,
  clearPath,
  clipTime,
  codeSample,
  coreConfig,
  descendantsOf,
  EASINGS,
  easingOf,
  emptyProject,
  groupBounds,
  hexToRgba,
  type Keyframe,
  keyframeAt,
  keyframeTimes,
  localPoint,
  moveKeyframe,
  objectStyle,
  onPath,
  PROPS,
  type PropKey,
  type PropValues,
  pathTable,
  presetPath,
  projectFile,
  type Rgba,
  readProjectFile,
  removeKeyframe,
  removeObject,
  removeTree,
  renameObject,
  reorderObject,
  rgbaToHex,
  SHAPE_LABELS,
  type ShapeKind,
  sampleProject,
  sequenceOf,
  setEasing,
  setFps,
  setKeyframe,
  setLength,
  setParent,
  setStatic,
  setValueAt,
  shiftPath,
  smoothPath,
  snap,
  stopAnimating,
  theatreStateFile,
  trackOf,
  updateObject,
  valuesAt,
} from '../../lib/animation';
import { decodeSound, loadImage, paddedSound, peaksOf, picturesOf } from '../../lib/animation-render';
import { type Box, inkBox, layerSvg, placeLayers, type SvgLayers, splitSvg, stageScale, svgDataUrl } from '../../lib/svg-layers';
import { copyText, pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { clamp, nudge, startDrag, usePersistentState } from './_shared';
import { ExportPanel } from './animation-export';

interface StudioState {
  readonly project: AnimProject;
  readonly loop: boolean;
}

/** Projects with big pictures or sound are not kept between sessions; they belong in a file. */
const MAX_DRAFT = 400_000;

/** Roughly how much text the pictures and the sound of a project come to. */
const weight = (project: AnimProject) => picturesOf(project).reduce((sum, url) => sum + url.length, project.audio?.src.length ?? 0);

const readStudio = (v: Values | undefined): StudioState => {
  let project = sampleProject();
  if (typeof v?.project === 'string' && v.project) {
    try {
      project = readProjectFile(v.project);
    } catch {
      project = sampleProject();
    }
  }
  return { project, loop: v?.loop !== false };
};
const writeStudio = (s: StudioState): Values => {
  if (weight(s.project) > MAX_DRAFT) return { project: '', loop: s.loop };
  const text = projectFile(s.project);
  return { project: text.length > MAX_DRAFT ? '' : text, loop: s.loop };
};

type Selected = { readonly key: string; readonly prop: PropKey; readonly id: string } | null;

const fmt = (t: number) => `${t.toFixed(2)} s`;
const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Number(n.toFixed(3)).toString());

const PATHS: readonly (readonly [Parameters<typeof presetPath>[0], string])[] = [
  ['line', 'Line'],
  ['arc', 'Arc'],
  ['circle', 'Circle'],
  ['wave', 'Wave'],
  ['eight', 'Figure of eight'],
];

const SOUND_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 320, height: img.naturalHeight || 240 });
    img.onerror = () => resolve({ width: 320, height: 240 });
    img.src = url;
  });
}

/**
 * Where each layer of an SVG has something drawn, in the drawing's own coordinates:
 * every layer is drawn on its own as a picture, and its pixels are looked at.
 */
async function measureLayers(split: SvgLayers): Promise<(Box | null)[]> {
  const fit = 512 / Math.max(split.view.width, split.view.height);
  const width = Math.max(1, Math.round(split.view.width * fit));
  const height = Math.max(1, Math.round(split.view.height * fit));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a drawing surface.');
  const boxes: (Box | null)[] = [];
  for (let index = 0; index < split.layers.length; index++) {
    let ink: Box | null = null;
    try {
      const image = await loadImage(svgDataUrl(layerSvg(split, index)));
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      ink = inkBox(ctx.getImageData(0, 0, width, height).data, width, height);
    } catch {
      ink = null;
    }
    boxes.push(
      ink
        ? {
            x: split.view.x + (ink.x / width) * split.view.width,
            y: split.view.y + (ink.y / height) * split.view.height,
            width: (ink.width / width) * split.view.width,
            height: (ink.height / height) * split.view.height,
          }
        : null,
    );
  }
  return boxes;
}

let playCount = 0;

function AnimationStudio({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readStudio, writeStudio);
  const root = state.project;
  /** The clip whose own timeline is being edited, if any. */
  const [inside, setInside] = useState<string | null>(null);
  const project = (inside ? root.clips?.[inside] : undefined) ?? root;
  const level = project === root ? null : inside;
  // The last frame first: it shows the finished scene (Play starts again from the beginning).
  const [time, setTime] = useState(() => sequenceOf(state.project).length);
  const [chosen, setChosen] = useState<string | null>(() => project.objects[0]?.key ?? null);
  const [selected, setSelected] = useState<Selected>(null);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState<Record<string, PropValues> | null>(null);
  const [scale, setScale] = useState(0.5);
  const [name, setName] = useState('');
  const [exporting, setExporting] = useState(false);
  /** A motion path being clicked out on the stage, in stage coordinates. */
  const [drawing, setDrawing] = useState<{ key: string; points: [number, number][] } | null>(null);
  const [sound, setSound] = useState<{ src: string; buffer: AudioBuffer } | null>(null);
  const history = useRef<{ past: AnimProject[]; future: AnimProject[] }>({ past: [], future: [] });
  const stageBox = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const wave = useRef<HTMLCanvasElement>(null);
  const objectList = useRef<HTMLUListElement>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const player = useRef<{ stop: () => void } | null>(null);
  const rootRef = useRef(root);
  rootRef.current = root;
  const projectRef = useRef(project);
  projectRef.current = project;
  const levelRef = useRef(level);
  levelRef.current = level;
  const timeRef = useRef(time);
  timeRef.current = time;
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const sequence = sequenceOf(project);
  const length = sequence.length;
  const fps = sequence.subUnitsPerUnit;
  const current = chosen ? project.objects.find((o) => o.key === chosen) : undefined;
  const find = (key: string | undefined) => (key === undefined ? undefined : projectRef.current.objects.find((o) => o.key === key));

  /** The whole project with the level being edited (the project itself, or one of its clips) replaced. */
  const lifted = (whole: AnimProject, edited: AnimProject): AnimProject => {
    const clip = levelRef.current;
    return clip && whole.clips?.[clip] ? { ...whole, clips: { ...whole.clips, [clip]: edited } } : edited;
  };

  /** Changes the project; `step` starts a new undo step (a drag is one step, not one per move). */
  const change = (next: AnimProject | ((p: AnimProject) => AnimProject), step = true) => {
    const before = projectRef.current;
    const after = typeof next === 'function' ? next(before) : next;
    if (after === before) return;
    const whole = lifted(rootRef.current, after);
    if (step) {
      history.current.past.push(rootRef.current);
      if (history.current.past.length > 100) history.current.past.shift();
      history.current.future = [];
    }
    projectRef.current = after;
    rootRef.current = whole;
    setState((s) => ({ ...s, project: whole }));
  };

  /** Puts a whole project in place (undo, redo): the clip being edited may be gone from it. */
  const restore = (whole: AnimProject) => {
    rootRef.current = whole;
    const clip = levelRef.current;
    const still = clip ? whole.clips?.[clip] : undefined;
    if (clip && !still) {
      levelRef.current = null;
      setInside(null);
      setChosen(null);
      setSelected(null);
    }
    projectRef.current = still ?? whole;
    setState((s) => ({ ...s, project: whole }));
  };
  const undo = () => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(rootRef.current);
    restore(previous);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(rootRef.current);
    restore(next);
  };

  // The stage scales to the width it is given.
  useEffect(() => {
    const box = stageBox.current;
    if (!box) return;
    const measure = () => setScale(Math.max(0.05, box.clientWidth / project.stage.width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [project.stage.width]);

  useEffect(
    () => () => {
      player.current?.stop();
      void audioContext.current?.close().catch(() => undefined);
    },
    [],
  );

  // The soundtrack as samples, for its waveform and for playing in step.
  const soundSrc = root.audio?.src;
  useEffect(() => {
    if (!soundSrc) {
      setSound(null);
      return;
    }
    if (soundRef.current?.src === soundSrc) return;
    let alive = true;
    decodeSound(soundSrc).then(
      (buffer) => {
        if (alive) setSound({ src: soundSrc, buffer });
      },
      () => {
        if (!alive) return;
        setSound(null);
        notify('The sound in this project could not be read here.', 'error');
      },
    );
    return () => {
      alive = false;
    };
  }, [soundSrc]);

  // The waveform under the ruler: the part of the sound the animation lasts for.
  useEffect(() => {
    const canvas = wave.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sound || level) return;
    ctx.fillStyle = getComputedStyle(canvas).color;
    const middle = canvas.height / 2;
    peaksOf(sound.buffer, length, canvas.width).forEach((peak, x) => {
      const tall = Math.max(1, peak * (canvas.height - 2));
      ctx.fillRect(x, middle - tall / 2, 1, tall);
    });
  }, [sound, length, level]);

  // The chosen object stays in sight in the list, which scrolls when there are many.
  useEffect(() => {
    objectList.current?.querySelector('li.is-chosen')?.scrollIntoView({ block: 'nearest' });
  }, [chosen]);

  const stop = () => {
    player.current?.stop();
    player.current = null;
  };

  /** Plays the sequence with @theatre/core, which then draws every frame (and plays the sound in step). */
  const play = () =>
    attempt(async () => {
      if (player.current) {
        stop();
        return;
      }
      const { getProject, onChange, types } = await import('@theatre/core');
      const snapshot = projectRef.current;
      const heard = soundRef.current;
      const voice = !levelRef.current && heard && rootRef.current.audio?.src === heard.src ? heard.buffer : null;
      // Each run gets a fresh Theatre.js project, so it plays the state as it is now.
      playCount += 1;
      const theatre = getProject(`Benchtop take ${playCount}`, { state: JSON.parse(JSON.stringify(snapshot.state)) });
      const sheet = theatre.sheet(snapshot.sheet);
      const values: Record<string, PropValues> = {};
      let frame = 0;
      const flush = () => {
        frame = 0;
        setLive({ ...values });
      };
      const untaps = snapshot.objects.map((o) =>
        sheet.object(o.key, coreConfig(o.kind, types)).onValuesChange((v) => {
          values[o.key] = v as unknown as PropValues;
          if (!frame) frame = requestAnimationFrame(flush);
        }),
      );
      untaps.push(onChange<number>(sheet.sequence.pointer.position, (position) => setTime(position)));
      let active = true;
      player.current = {
        stop: () => {
          if (!active) return;
          active = false;
          sheet.sequence.pause();
          for (const untap of untaps) untap();
          if (frame) cancelAnimationFrame(frame);
          setTime(sheet.sequence.position);
          setLive(null);
          setPlaying(false);
          player.current = null;
        },
      };
      setPlaying(true);
      await theatre.ready;
      if (voice) {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContext.current ??= new Context();
        await audioContext.current.resume();
        // Theatre.js starts the sound with the sequence and restarts both together on every loop.
        await sheet.sequence.attachAudio({ source: paddedSound(voice, length, audioContext.current), audioContext: audioContext.current });
      }
      if (!active) return;
      const start = timeRef.current >= length - 1e-6 ? 0 : timeRef.current;
      sheet.sequence.position = start;
      const turns = state.loop ? (voice ? 1000 : Number.POSITIVE_INFINITY) : 1;
      const finished = await sheet.sequence.play({ iterationCount: turns, range: [0, length] });
      if (finished && active) player.current?.stop();
    });

  const seek = (t: number) => {
    stop();
    setTime(clamp(t, 0, length));
  };

  const at = (key: string) => (live?.[key] ? live[key] : valuesAt(project, key, time));

  const setProp = (key: string, prop: PropKey, value: number | Rgba, step = true) => {
    stop();
    change((p) => setValueAt(p, key, prop, timeRef.current, value), step);
  };

  /** Goes into a clip to edit its own stage and timeline, or back out (null). */
  const goInside = (clip: string | null) => {
    stop();
    setDrawing(null);
    const target = clip ? rootRef.current.clips?.[clip] : undefined;
    const left = levelRef.current;
    levelRef.current = target ? clip : null;
    projectRef.current = target ?? rootRef.current;
    setInside(target ? clip : null);
    // Coming back out, the clip that was edited stays chosen.
    const back = target ? undefined : rootRef.current.objects.find((o) => o.kind === 'clip' && o.clip === left);
    setChosen((back ?? projectRef.current.objects[0])?.key ?? null);
    setSelected(null);
    setTime(0);
  };

  /** Forgets a choice that a change has just removed. */
  const tidyChoice = () => {
    const left = projectRef.current.objects;
    setChosen((key) => (key && left.some((o) => o.key === key) ? key : null));
    setSelected((s) => (s && left.some((o) => o.key === s.key) ? s : null));
  };

  /* ------------------------------------------------------------ files -- */

  /** Replaces the whole project (a file, the sample, a new one): history and the clip being edited are left behind. */
  const replaceProject = (next: AnimProject, as: string, startAt: number) => {
    stop();
    setDrawing(null);
    history.current = { past: [], future: [] };
    levelRef.current = null;
    rootRef.current = next;
    projectRef.current = next;
    setInside(null);
    setState((s) => ({ ...s, project: next }));
    setChosen(next.objects[0]?.key ?? null);
    setSelected(null);
    setTime(startAt);
    setName(as);
  };

  const open = () =>
    attempt(async () => {
      const [file] = await pickFiles('.json,application/json');
      if (!file) return;
      replaceProject(readProjectFile(await file.text()), file.name.replace(/\.animation\.json$|\.theatre\.json$|\.json$/i, ''), 0);
      notify(`Opened ${file.name}`);
    });

  const baseName = () =>
    (name || root.name)
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80) || 'animation';

  const save = (format: 'project' | 'state' | 'html') =>
    attempt(async () => {
      let outcome: Awaited<ReturnType<typeof saveFile>>;
      if (format === 'project') outcome = await saveFile(`${baseName()}.animation.json`, projectFile(root), 'application/json');
      else if (format === 'state') outcome = await saveFile(`${baseName()}.theatre.json`, theatreStateFile(root), 'application/json');
      else {
        const [core, dataverse, licence] = await Promise.all([
          import('../../../node_modules/@theatre/core/dist/index.js?raw').then((m) => m.default),
          import('../../../node_modules/@theatre/dataverse/dist/index.js?raw').then((m) => m.default),
          import('../../../node_modules/@theatre/core/LICENSE?raw').then((m) => m.default),
        ]);
        outcome = await saveFile(`${baseName()}.html`, animationHtml(root, { core, dataverse, licence }, { loop: state.loop }), 'text/html');
      }
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const add = (kind: ShapeKind) =>
    attempt(async () => {
      stop();
      let created = '';
      if (kind === 'picture') {
        const [file] = await pickFiles('image/*');
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} is larger than 4 MB; make it smaller first (Image Resizer) so the project stays quick.`);
        const picture = await readAsDataUrl(file);
        const size = await imageSize(picture);
        const stage = projectRef.current.stage;
        const fit = Math.min(1, (stage.width * 0.5) / size.width, (stage.height * 0.5) / size.height);
        change((p) => {
          const r = addObject(p, 'picture', { key: file.name.replace(/\.[^.]+$/, ''), picture });
          created = r.key;
          return setValueAt(setValueAt(r.project, r.key, 'width', 0, Math.round(size.width * fit)), r.key, 'height', 0, Math.round(size.height * fit));
        });
      } else if (kind === 'clip') {
        // A clip starts empty, half the size of the stage and the same shape; it is filled by editing it.
        change((p) => {
          const blank = { ...emptyProject('Clip'), stage: { ...p.stage, width: Math.round(p.stage.width / 2), height: Math.round(p.stage.height / 2) } };
          const r = addClip(p, blank, 'Clip');
          created = r.key;
          return r.project;
        });
      } else {
        change((p) => {
          const r = addObject(p, kind, kind === 'text' ? { text: 'Your text' } : {});
          created = r.key;
          return r.project;
        });
      }
      setChosen(created);
    });

  /** An SVG drawing as a group of pictures, one for each of its layers, to animate one by one. */
  const addLayers = () =>
    attempt(async () => {
      const [file] = await pickFiles('.svg,image/svg+xml');
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} is larger than 4 MB; simplify it first (SVG Optimiser).`);
      const split = splitSvg(await file.text());
      const stage = projectRef.current.stage;
      const placed = placeLayers(split, await measureLayers(split), stageScale(split.view, stage));
      if (placed.length === 0) throw new Error(`Nothing in ${file.name} could be drawn.`);
      if (placed.reduce((sum, layer) => sum + layer.picture.length, 0) > 12 * 1024 * 1024) throw new Error(`The layers of ${file.name} come to more than 12 MB; simplify it first (SVG Optimiser).`);
      stop();
      let group = '';
      change((p) => {
        const made = addObject(p, 'group', { key: file.name.replace(/\.[^.]+$/, '') });
        group = made.key;
        let next = made.project;
        for (const layer of placed) {
          const r = addObject(next, 'picture', { key: layer.name, picture: layer.picture, parent: group });
          next = setStatic(setStatic(setStatic(setStatic(r.project, r.key, 'x', layer.x), r.key, 'y', layer.y), r.key, 'width', layer.width), r.key, 'height', layer.height);
        }
        return next;
      });
      setChosen(group);
      notify(`${placed.length} ${placed.length === 1 ? 'layer' : 'layers'} from ${file.name}, in the group “${group}”`);
    });

  const addSound = () =>
    attempt(async () => {
      const [file] = await pickFiles(
        `audio/*,${Object.keys(SOUND_TYPES)
          .map((ext) => `.${ext}`)
          .join(',')}`,
      );
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than 12 MB; shorten or compress it first.`);
      const type = file.type.startsWith('audio/') ? file.type : SOUND_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
      if (!type) throw new Error('Choose a sound file: WAV, MP3, OGG, M4A or FLAC.');
      const src = await readAsDataUrl(new Blob([await file.arrayBuffer()], { type }));
      let buffer: AudioBuffer;
      try {
        buffer = await decodeSound(src);
      } catch {
        throw new Error(`${file.name} could not be read as sound here; try WAV, MP3 or OGG.`);
      }
      stop();
      setSound({ src, buffer });
      change((p) => ({ ...p, audio: { name: file.name.slice(0, 80), src } }));
      notify(`${file.name}: ${buffer.duration.toFixed(2)} s of sound`);
    });

  /** Another saved animation as the content of a clip. */
  const loadIntoClip = (clip: string) =>
    attempt(async () => {
      const [file] = await pickFiles('.json,application/json');
      if (!file) return;
      const inner = asClip(readProjectFile(await file.text()));
      stop();
      change((p) => (p.clips?.[clip] ? { ...p, clips: { ...p.clips, [clip]: inner } } : p));
      notify(`${file.name} now plays in this clip`);
    });

  /* ----------------------------------------------------- motion paths -- */

  /** Puts an object on a path; unless it is animated already, it travels the whole path over the whole timeline. */
  const applyPath = (key: string, d: string) => {
    stop();
    change((p) => {
      let next = updateObject(p, key, { path: d });
      if (!trackOf(next, key, 'progress')) {
        next = setKeyframe(next, key, 'progress', 0, 0);
        next = setKeyframe(next, key, 'progress', sequenceOf(next).length, 1);
      }
      return next;
    });
  };

  const layPreset = (o: AnimObject, kind: Parameters<typeof presetPath>[0]) => {
    const p = projectRef.current;
    const d = presetPath(kind, p.stage.width, p.stage.height);
    // Inside a group, the path is measured from the group's middle.
    const corner = localPoint(p, o.parent, 0, 0, timeRef.current);
    applyPath(o.key, o.parent ? shiftPath(d, corner.x, corner.y) : d);
  };

  const finishDrawing = () => {
    const drawn = drawing;
    if (!drawn) return;
    setDrawing(null);
    const object = find(drawn.key);
    const points = drawn.points.filter((point, index) => {
      const before = drawn.points[index - 1];
      return !before || before[0] !== point[0] || before[1] !== point[1];
    });
    if (!object) return;
    if (points.length < 2) {
      notify('Click at least two places on the stage to draw a path.', 'error');
      return;
    }
    const local = points.map(([x, y]) => {
      const place = localPoint(projectRef.current, object.parent, x, y, timeRef.current);
      return [place.x, place.y] as const;
    });
    applyPath(drawn.key, smoothPath(local));
  };

  const addPoint = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const stage = projectRef.current.stage;
    const x = Math.round(((event.clientX - rect.left) / (rect.width || 1)) * stage.width);
    const y = Math.round(((event.clientY - rect.top) / (rect.height || 1)) * stage.height);
    setDrawing((d) => (d ? { ...d, points: [...d.points, [x, y]] } : d));
  };

  /* -------------------------------------------------------- shortcuts -- */

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    if (drawing && (e.key === 'Escape' || (e.key === 'Enter' && !typing))) {
      e.preventDefault();
      if (e.key === 'Escape') setDrawing(null);
      else finishDrawing();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      // Text fields keep their own undo; a list box has none, so the editor's applies.
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (typing) return;
    if (e.key === ' ' && !target.closest('button')) {
      e.preventDefault();
      void play();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      change((p) => removeKeyframe(p, selected.key, selected.prop, selected.id));
      setSelected(null);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seek(length);
    }
  };

  /* ------------------------------------------------------------ stage -- */

  /**
   * What a click on an object picks: the object itself at the top or beside the chosen one,
   * otherwise the outermost group it is in (a double-click goes inside).
   */
  const pickTarget = (o: AnimObject): AnimObject => {
    const openGroups = new Set<string | undefined>([undefined]);
    for (let up = current?.parent; up !== undefined && !openGroups.has(up); up = find(up)?.parent) openGroups.add(up);
    let target = o;
    while (target.parent !== undefined && !openGroups.has(target.parent)) {
      const holder = find(target.parent);
      if (!holder) break;
      target = holder;
    }
    return target;
  };

  /** Moves an object by a distance on the stage: its position, or its whole path when it travels along one. */
  const moved = (p: AnimProject, o: AnimObject, from: { x: number; y: number; path: string | undefined }, dx: number, dy: number): AnimProject => {
    const by = localPoint(p, o.parent, dx, dy, timeRef.current, false);
    if (from.path) return updateObject(p, o.key, { path: shiftPath(from.path, by.x, by.y) });
    return setValueAt(setValueAt(p, o.key, 'x', timeRef.current, Math.round(from.x + by.x)), o.key, 'y', timeRef.current, Math.round(from.y + by.y));
  };

  const dragObject = (event: PointerEvent, o: AnimObject) => {
    setChosen(o.key);
    // Dragging keeps the browser from moving focus, so the arrow keys would not reach the object.
    elements.current.get(o.key)?.focus({ preventScroll: true });
    const surface = stageBox.current;
    if (!surface) return;
    stop();
    const startValues = valuesAt(projectRef.current, o.key, timeRef.current);
    const from = { x: startValues.x as number, y: startValues.y as number, path: o.path };
    const origin = { x: event.clientX, y: event.clientY };
    let first = true;
    startDrag(event, surface, (_fx, _fy, e) => {
      const dx = (e.clientX - origin.x) / scale;
      const dy = (e.clientY - origin.y) / scale;
      if (first && Math.abs(dx) + Math.abs(dy) < 2 / scale) return;
      change((p) => moved(p, o, from, dx, dy), first);
      first = false;
    });
  };

  const nudgeObject = (e: KeyboardEvent, o: AnimObject) => {
    const step = nudge(e);
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const v = valuesAt(projectRef.current, o.key, timeRef.current);
    change((p) => moved(p, find(o.key) ?? o, { x: v.x as number, y: v.y as number, path: find(o.key)?.path }, step.dx, step.dy));
  };

  /** A clip's own animation at the moment the main timeline is at `t`, scaled to fit the clip object. */
  const renderClip = (o: AnimObject, v: PropValues, t: number): ComponentChildren => {
    const clip = o.clip ? root.clips?.[o.clip] : undefined;
    if (!clip) return null;
    const fit = Math.min(Math.max(0, v.width as number) / clip.stage.width, Math.max(0, v.height as number) / clip.stage.height);
    const local = clipTime(o, t, sequenceOf(clip).length);
    return (
      <div class="anim-clip-inner" style={{ width: `${clip.stage.width}px`, height: `${clip.stage.height}px`, transform: `scale(${fit}) translate(-50%, -50%)` }}>
        {clip.objects.length === 0 ? <span class="anim-clip-empty">Empty clip: double-click to edit it</span> : renderObjects(clip, undefined, local)}
      </div>
    );
  };

  /** The objects in a group (or at the top).  `t` is null on the stage being edited, and a time inside a clip that is only shown. */
  const renderObjects = (source: AnimProject, parent: string | undefined, t: number | null): ComponentChildren[] => {
    const drawn: ComponentChildren[] = childrenOf(source, parent).map((o) => renderObject(source, o, t));
    // The chosen object's motion path, in the coordinates of whatever holds the object.
    const route = t === null && current?.path && current.parent === parent ? pathTable(current.path) : null;
    if (route && route.lengths.length > 1 && current?.path) {
      drawn.push(
        <svg key="motion path" class="anim-path" width="1" height="1" aria-hidden="true" data-testid="anim-route">
          <path d={current.path} />
          <circle cx={route.points[0]} cy={route.points[1]} r={5 / scale} />
          <circle class="anim-path-end" cx={route.points[route.points.length - 2]} cy={route.points[route.points.length - 1]} r={5 / scale} />
        </svg>,
      );
    }
    return drawn;
  };

  const renderObject = (source: AnimProject, o: AnimObject, t: number | null): ComponentChildren => {
    const v = onPath(o, t === null ? at(o.key) : valuesAt(source, o.key, t));
    const style = { ...objectStyle(o.kind, v), ...(o.kind === 'picture' && o.picture ? { backgroundImage: `url("${o.picture}")` } : {}) };
    let content: ComponentChildren = null;
    if (o.kind === 'text') content = o.text;
    else if (o.kind === 'clip') content = renderClip(o, v, t ?? time);
    else if (o.kind === 'group') {
      const box = t === null ? groupBounds(source, o.key, time) : null;
      // The frame shows how far the group reaches, and is what an empty group is picked up by.
      const frame =
        t === null ? (
          <span
            key="group frame"
            class={`anim-group-frame${box ? '' : ' is-empty'}`}
            style={box ? { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` } : { left: '-40px', top: '-40px', width: '80px', height: '80px' }}
          />
        ) : null;
      content = [frame, ...renderObjects(source, o.key, t)];
    }
    if (t !== null) {
      return (
        <div key={o.key} class={`anim-obj anim-${o.kind}`} style={style}>
          {content}
        </div>
      );
    }
    const label = o.kind === 'text' ? `${o.text ?? ''} (${o.key})` : `${o.key} (${SHAPE_LABELS[o.kind].toLowerCase()})`;
    const shared = {
      ref: (el: HTMLDivElement | null) => {
        if (el) elements.current.set(o.key, el);
        else elements.current.delete(o.key);
      },
      class: `anim-obj anim-${o.kind}${o.key === chosen ? ' is-chosen' : ''}`,
      style,
      onPointerDown: (e: PointerEvent) => {
        e.stopPropagation();
        dragObject(e, pickTarget(o));
      },
      onDblClick: (e: MouseEvent) => {
        e.stopPropagation();
        if (o.kind === 'clip' && o.clip && !level) goInside(o.clip);
        else setChosen(o.key);
      },
      onKeyDown: (e: KeyboardEvent) => nudgeObject(e, o),
      onFocus: (e: FocusEvent) => {
        if (e.target === e.currentTarget) setChosen(o.key);
      },
      'data-testid': `anim-obj-${o.key}`,
    };
    // A group holds other objects that are picked themselves, so it is a group to assistive technology, not a button.
    if (o.kind === 'group') {
      return (
        <div
          key={o.key}
          {...shared}
          role="group"
          aria-label={label}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a group is picked and moved with the keyboard like any other object
          tabIndex={0}
        >
          {content}
        </div>
      );
    }
    return (
      <div key={o.key} {...shared} role="button" aria-label={label} aria-pressed={o.key === chosen} tabIndex={0}>
        {content}
      </div>
    );
  };

  /* --------------------------------------------------------- timeline -- */

  const scrub = (event: PointerEvent) => {
    const lane = event.currentTarget as HTMLElement;
    const set = (fx: number) => seek(snap(projectRef.current, clamp(fx, 0, 1) * length));
    const rect = lane.getBoundingClientRect();
    set((event.clientX - rect.left) / (rect.width || 1));
    startDrag(event, lane, (fx) => set(fx));
  };

  const dragKeyframe = (event: PointerEvent, key: string, prop: PropKey, k: Keyframe) => {
    event.stopPropagation();
    setSelected({ key, prop, id: k.id });
    setChosen(key);
    seek(k.position);
    const lane = (event.currentTarget as HTMLElement).parentElement;
    if (!lane) return;
    let first = true;
    startDrag(event, lane, (fx) => {
      const t = snap(projectRef.current, clamp(fx, 0, 1) * length);
      const now = trackOf(projectRef.current, key, prop)?.keyframes.find((x) => x.id === k.id);
      if (!now || Math.abs(now.position - t) < 1e-6) return;
      change((p) => moveKeyframe(p, key, prop, k.id, t), first);
      first = false;
      setTime(t);
    });
  };

  /** Dragging a clip's bar along its row changes when the clip starts. */
  const dragClip = (event: PointerEvent, o: AnimObject) => {
    event.stopPropagation();
    setChosen(o.key);
    const lane = (event.currentTarget as HTMLElement).parentElement;
    if (!lane) return;
    stop();
    const rect = lane.getBoundingClientRect();
    const held = ((event.clientX - rect.left) / (rect.width || 1)) * length - (o.start ?? 0);
    let first = true;
    startDrag(event, lane, (fx) => {
      const start = snap(projectRef.current, clamp(fx * length - held, 0, length));
      if (Math.abs(start - (find(o.key)?.start ?? 0)) < 1e-6) return;
      change((p) => updateObject(p, o.key, { start }), first);
      first = false;
    });
  };

  const keyframeKeys = (e: KeyboardEvent, key: string, prop: PropKey, k: Keyframe) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const t = snap(projectRef.current, k.position + ((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)) / fps);
      change((p) => moveKeyframe(p, key, prop, k.id, clamp(t, 0, length)));
      setTime(clamp(t, 0, length));
    }
  };

  const selectedKeyframe = selected ? trackOf(project, selected.key, selected.prop)?.keyframes.find((k) => k.id === selected.id) : undefined;
  const selectedEasing = selected && selectedKeyframe ? easingOf(project, selected.key, selected.prop, selected.id) : '';
  const times = useMemo(() => keyframeTimes(project), [project]);
  const ticks = useMemo(() => {
    const step = length <= 2 ? 0.25 : length <= 6 ? 0.5 : length <= 20 ? 1 : length <= 60 ? 5 : 10;
    const out: number[] = [];
    for (let t = 0; t <= length + 1e-9; t += step) out.push(Number(t.toFixed(3)));
    return out;
  }, [length]);
  /** Every object with how deep it sits in groups, members right after their group. */
  const listed = useMemo(() => {
    const out: { o: AnimObject; depth: number }[] = [];
    const visit = (parent: string | undefined, depth: number) => {
      for (const o of childrenOf(project, parent)) {
        out.push({ o, depth });
        if (o.kind === 'group' && depth < 16) visit(o.key, depth + 1);
      }
    };
    visit(undefined, 0);
    return out;
  }, [project]);
  const tooBigToKeep = useMemo(() => weight(root) > MAX_DRAFT, [root]);

  const percent = (t: number) => `${(clamp(t, 0, length) / length) * 100}%`;
  const values = current ? at(current.key) : null;
  /** Groups the chosen object could go into: not itself, nor anything inside it. */
  const homes = current ? project.objects.filter((o) => o.kind === 'group' && o.key !== current.key && !descendantsOf(project, current.key).some((d) => d.key === o.key)) : [];
  const currentClip = current?.kind === 'clip' && current.clip ? root.clips?.[current.clip] : undefined;

  return (
    <section class="tool anim-tool" data-testid="tool" data-state={project.objects.length ? 'done' : 'idle'} onKeyDown={onKeyDown}>
      <div class="button-row anim-files">
        <button type="button" class="button button-small" onClick={open} data-testid="anim-open">
          <Icon name="open" size={15} /> Open
        </button>
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() => {
            const sample = sampleProject();
            const before = rootRef.current;
            replaceProject(sample, '', sequenceOf(sample).length);
            // The project that was open can still be had back with Undo.
            history.current.past.push(before);
            setChosen('Ball');
          }}
        >
          <Icon name="sample" size={15} /> Sample
        </button>
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() => {
            const before = rootRef.current;
            replaceProject(emptyProject(), '', 0);
            history.current.past.push(before);
          }}
        >
          <Icon name="plus" size={15} /> New
        </button>
        <span class="anim-add" role="group" aria-label="Add">
          <span class="control-label">Add</span>
          {(level ? (['box', 'ellipse', 'text', 'picture', 'group'] as const) : (['box', 'ellipse', 'text', 'picture', 'group', 'clip'] as const)).map((kind) => (
            <button
              key={kind}
              type="button"
              class="button button-small"
              onClick={() => add(kind)}
              title={kind === 'group' ? 'Objects put in a group move, turn, scale and fade together' : kind === 'clip' ? 'An animation with a timeline of its own, played inside this one' : undefined}
              data-testid={`anim-add-${kind}`}
            >
              {SHAPE_LABELS[kind]}
            </button>
          ))}
          <button type="button" class="button button-small" onClick={addLayers} title="An SVG drawing as one picture for each of its layers, in a group" data-testid="anim-add-layers">
            SVG layers
          </button>
        </span>
        <span class="anim-save" role="group" aria-label="Save">
          <span class="control-label">Save as</span>
          <button type="button" class="button button-small" onClick={() => save('html')} data-testid="anim-html">
            Web page
          </button>
          <button type="button" class="button button-small" aria-expanded={exporting} onClick={() => setExporting((on) => !on)} data-testid="anim-video">
            Video…
          </button>
          <button type="button" class="button button-small" onClick={() => save('state')} data-testid="anim-state">
            Theatre.js state
          </button>
          <button type="button" class="button button-small" onClick={() => save('project')} data-testid="anim-project">
            Project
          </button>
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() =>
              attempt(async () => {
                await copyText(codeSample(root));
                notify('Code for @theatre/core copied');
              })
            }
          >
            <Icon name="copy" size={13} /> Code
          </button>
        </span>
      </div>

      {exporting && <ExportPanel project={root} name={baseName()} loop={state.loop} sound={sound?.buffer ?? null} />}
      {tooBigToKeep && (
        <p class="control-help anim-keep-note" data-testid="anim-keep-note">
          With its pictures and sound, this project is too large to be kept here between sessions: save it as a Project file.
        </p>
      )}
      {level && (
        <div class="anim-inside" data-testid="anim-inside">
          <span>
            Editing the clip <strong>{level}</strong>: it has a stage and a timeline of its own, {fmt(length)} long.
          </span>
          <button type="button" class="button button-small" onClick={() => goInside(null)} data-testid="anim-leave">
            <Icon name="left" size={14} /> Back to the main timeline
          </button>
        </div>
      )}

      <div class="anim-main">
        <div class="anim-stage-wrap" ref={stageBox} style={{ height: `${project.stage.height * scale}px` }}>
          <div
            class="anim-stage"
            data-testid="anim-stage"
            style={{ width: `${project.stage.width}px`, height: `${project.stage.height}px`, background: project.stage.background, transform: `scale(${scale})` }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setChosen(null);
            }}
          >
            {renderObjects(project, undefined, null)}
            {project.objects.length === 0 && <p class="anim-empty">{level ? 'This clip is empty: add a box, an ellipse, text or a picture.' : 'Add a box, an ellipse, text or a picture to start.'}</p>}
            {drawing && (
              <div class="anim-draw" onPointerDown={addPoint} onDblClick={finishDrawing} data-testid="anim-draw">
                <svg viewBox={`0 0 ${project.stage.width} ${project.stage.height}`} aria-hidden="true">
                  {drawing.points.length > 1 && <path d={smoothPath(drawing.points)} />}
                  {drawing.points.map(([x, y], index) => (
                    <circle key={`${index}:${x}:${y}`} cx={x} cy={y} r={5 / scale} />
                  ))}
                </svg>
              </div>
            )}
          </div>
        </div>

        <aside class="anim-side" aria-label="Objects and props">
          <div class="anim-panel">
            <div class="anim-panel-head">
              <span class="pane-title">Objects</span>
              <span class="tone-muted">later ones are drawn on top</span>
            </div>
            <ul class="anim-objects" ref={objectList} data-testid="anim-objects">
              {listed.map(({ o, depth }) => (
                <li key={o.key} class={o.key === chosen ? 'is-chosen' : ''} style={depth ? { paddingLeft: `${8 + depth * 14}px` } : undefined}>
                  <button type="button" class="link-button anim-object-name" aria-pressed={o.key === chosen} onClick={() => setChosen(o.key)}>
                    {o.key}
                  </button>
                  <span class="tone-muted">{SHAPE_LABELS[o.kind]}</span>
                  <span class="anim-object-actions">
                    <button type="button" class="button button-small button-quiet" title="Draw lower" aria-label={`Draw ${o.key} lower`} onClick={() => change((p) => reorderObject(p, o.key, -1))}>
                      <Icon name="down" size={13} />
                    </button>
                    <button type="button" class="button button-small button-quiet" title="Draw higher" aria-label={`Draw ${o.key} higher`} onClick={() => change((p) => reorderObject(p, o.key, 1))}>
                      <Icon name="up" size={13} />
                    </button>
                    <button
                      type="button"
                      class="button button-small button-quiet"
                      title={o.kind === 'group' ? 'Delete the group and everything in it' : 'Delete'}
                      aria-label={`Delete ${o.key}`}
                      onClick={() => {
                        stop();
                        if (drawing?.key === o.key) setDrawing(null);
                        change((p) => removeTree(p, o.key));
                        tidyChoice();
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {current && values && (
            <div class="anim-panel" data-testid="anim-inspector">
              <div class="anim-panel-head">
                <label class="anim-rename">
                  <span class="visually-hidden">Name</span>
                  <input
                    class="input"
                    value={current.key}
                    aria-label="Object name"
                    onChange={(e) => {
                      const wanted = e.currentTarget.value;
                      const next = renameObject(projectRef.current, current.key, wanted);
                      if (next === projectRef.current) return;
                      const renamed = next.objects.find((o) => !projectRef.current.objects.some((p) => p.key === o.key))?.key;
                      change(next);
                      if (renamed) {
                        setChosen(renamed);
                        if (selected?.key === current.key) setSelected({ ...selected, key: renamed });
                        if (drawing?.key === current.key) setDrawing(null);
                      }
                    }}
                  />
                </label>
              </div>
              {current.kind === 'text' && (
                <label class="anim-field anim-field-wide">
                  <span class="control-label">Text</span>
                  <textarea class="input" rows={2} value={current.text ?? ''} onInput={(e) => change((p) => updateObject(p, current.key, { text: e.currentTarget.value.slice(0, 2000) }), false)} />
                </label>
              )}
              {(homes.length > 0 || current.parent !== undefined) && (
                <label class="anim-field anim-field-wide">
                  <span class="control-label">Inside</span>
                  <select
                    class="select select-small"
                    value={current.parent ?? ''}
                    data-testid="anim-parent"
                    onChange={(e) => {
                      stop();
                      const home = e.currentTarget.value;
                      change((p) => setParent(p, current.key, home === '' ? undefined : home));
                    }}
                  >
                    <option value="">No group</option>
                    {homes.map((group) => (
                      <option key={group.key} value={group.key}>
                        {group.key}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {current.kind === 'group' && (
                <div class="anim-extra" data-testid="anim-group">
                  <p class="control-help anim-help">
                    A group moves, turns, scales and fades what is inside it together ({childrenOf(project, current.key).length} inside). Click a member twice to pick it on the stage; “Inside” on any
                    object puts it in a group.
                  </p>
                  <button
                    type="button"
                    class="button button-small"
                    data-testid="anim-ungroup"
                    onClick={() => {
                      stop();
                      change((p) => removeObject(p, current.key));
                      tidyChoice();
                    }}
                  >
                    Ungroup
                  </button>
                </div>
              )}
              {current.kind === 'clip' && current.clip && (
                <div class="anim-extra" data-testid="anim-clip">
                  <p class="control-help anim-help">
                    A clip is an animation with a timeline of its own{currentClip ? `, ${fmt(sequenceOf(currentClip).length)} long` : ''}, played inside this one and scaled to fit the clip’s box.
                  </p>
                  <div class="anim-props">
                    <label class="anim-field">
                      <span class="control-label">Starts at (s)</span>
                      <input
                        type="number"
                        class="input input-number"
                        min={0}
                        max={600}
                        step={0.1}
                        value={num(current.start ?? 0)}
                        data-testid="anim-clip-start"
                        onChange={(e) => {
                          const n = Number(e.currentTarget.value);
                          if (Number.isFinite(n)) change((p) => updateObject(p, current.key, { start: clamp(n, 0, 600) }));
                        }}
                      />
                    </label>
                    <label class="anim-field">
                      <span class="control-label">Speed</span>
                      <input
                        type="number"
                        class="input input-number"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={num(current.speed ?? 1)}
                        data-testid="anim-clip-speed"
                        onChange={(e) => {
                          const n = Number(e.currentTarget.value);
                          if (Number.isFinite(n) && n > 0) change((p) => updateObject(p, current.key, { speed: clamp(n, 0.1, 10) }));
                        }}
                      />
                    </label>
                    <label class="check">
                      <input
                        type="checkbox"
                        checked={current.loop === true}
                        data-testid="anim-clip-loop"
                        onChange={(e) => change((p) => updateObject(p, current.key, { loop: e.currentTarget.checked }))}
                      />{' '}
                      Repeat
                    </label>
                  </div>
                  {!level && (
                    <div class="button-row">
                      <button type="button" class="button button-small" onClick={() => goInside(current.clip ?? null)} data-testid="anim-clip-edit">
                        Edit the clip’s timeline
                      </button>
                      <button type="button" class="button button-small button-quiet" onClick={() => loadIntoClip(current.clip ?? '')} data-testid="anim-clip-load">
                        <Icon name="open" size={13} /> Load a saved project into it
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div class="anim-extra" data-testid="anim-path">
                <span class="control-label" id="anim-path-label">
                  Motion path
                </span>
                <div class="button-row" role="group" aria-labelledby="anim-path-label">
                  {PATHS.map(([kind, label]) => (
                    <button key={kind} type="button" class="button button-small" onClick={() => layPreset(current, kind)} data-testid={`anim-path-${kind}`}>
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    class="button button-small"
                    aria-pressed={drawing?.key === current.key}
                    data-testid="anim-path-draw"
                    onClick={() => {
                      stop();
                      if (drawing?.key === current.key) finishDrawing();
                      else setDrawing({ key: current.key, points: [] });
                    }}
                  >
                    {drawing?.key === current.key ? 'Finish drawing' : 'Draw…'}
                  </button>
                  {current.path && (
                    <button
                      type="button"
                      class="button button-small button-quiet"
                      data-testid="anim-path-clear"
                      onClick={() => {
                        stop();
                        change((p) => clearPath(p, current.key));
                        setSelected((s) => (s?.key === current.key && s.prop === 'progress' ? null : s));
                      }}
                    >
                      <Icon name="trash" size={13} /> Remove
                    </button>
                  )}
                </div>
                {drawing?.key === current.key && (
                  <p class="control-help anim-help" role="status">
                    Click along the route on the stage ({drawing.points.length} {drawing.points.length === 1 ? 'place' : 'places'} so far), then Finish drawing or press Enter. Escape gives up.
                  </p>
                )}
                {current.path && (
                  <div class="anim-path-set">
                    <label class="check">
                      <input
                        type="checkbox"
                        checked={current.follow === true}
                        data-testid="anim-path-follow"
                        onChange={(e) => change((p) => updateObject(p, current.key, { follow: e.currentTarget.checked }))}
                      />{' '}
                      Turn to face the way it moves
                    </label>
                    <label class="anim-field anim-field-wide">
                      <span class="control-label">Path data (as in an SVG path)</span>
                      <input
                        class="input"
                        value={current.path}
                        spellcheck={false}
                        data-testid="anim-path-data"
                        onChange={(e) => {
                          const d = e.currentTarget.value.trim().slice(0, 20_000);
                          if (pathTable(d).lengths.length > 1) change((p) => updateObject(p, current.key, { path: d }));
                          else {
                            e.currentTarget.value = current.path ?? '';
                            notify('That is not path data with at least two points.', 'error');
                          }
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
              <p class="control-help anim-help">Values are at {fmt(time)}. ◇ starts animating a prop; then any change you make adds a keyframe at the playhead.</p>
              <div class="anim-props">
                {PROPS.filter((spec) => (!spec.only || spec.only.includes(current.kind)) && (spec.key === 'progress' ? !!current.path : !(current.path && (spec.key === 'x' || spec.key === 'y')))).map(
                  (spec) => {
                    const animated = !!trackOf(project, current.key, spec.key);
                    const here = animated ? keyframeAt(project, current.key, spec.key, time) : undefined;
                    const value = values[spec.key];
                    return (
                      <div key={spec.key} class={`anim-prop${animated ? ' is-animated' : ''}`}>
                        <span class="anim-prop-label" id={`anim-${spec.key}`}>
                          {spec.label}
                        </span>
                        {spec.type === 'number' ? (
                          <input
                            type="number"
                            class="input input-number"
                            step={spec.step}
                            min={spec.range?.[0]}
                            max={spec.range?.[1]}
                            value={num(value as number)}
                            aria-labelledby={`anim-${spec.key}`}
                            data-testid={`anim-prop-${spec.key}`}
                            onChange={(e) => {
                              const n = Number(e.currentTarget.value);
                              if (Number.isFinite(n)) setProp(current.key, spec.key, n);
                            }}
                          />
                        ) : (
                          <span class="anim-colour">
                            <input
                              type="color"
                              value={rgbaToHex(value as Rgba)}
                              aria-label={`${spec.label} of ${current.key}`}
                              onChange={(e) => setProp(current.key, spec.key, hexToRgba(e.currentTarget.value, (value as Rgba).a))}
                            />
                            <input
                              type="number"
                              class="input input-number anim-alpha"
                              min={0}
                              max={1}
                              step={0.05}
                              value={num((value as Rgba).a)}
                              aria-label={`${spec.label} opacity of ${current.key}`}
                              onChange={(e) => {
                                const a = Number(e.currentTarget.value);
                                if (Number.isFinite(a)) setProp(current.key, spec.key, { ...(value as Rgba), a: clamp(a, 0, 1) });
                              }}
                            />
                          </span>
                        )}
                        <button
                          type="button"
                          class={`anim-key-button${here ? ' is-on' : ''}`}
                          title={!animated ? 'Animate this prop (a keyframe at the playhead)' : here ? 'Remove the keyframe at the playhead' : 'Add a keyframe at the playhead'}
                          aria-label={!animated ? `Animate ${spec.label}` : here ? `Remove ${spec.label} keyframe at ${fmt(time)}` : `Add ${spec.label} keyframe at ${fmt(time)}`}
                          data-testid={`anim-key-${spec.key}`}
                          onClick={() => {
                            stop();
                            if (!animated) change((p) => animate(p, current.key, spec.key, timeRef.current));
                            else if (here) change((p) => removeKeyframe(p, current.key, spec.key, here.id));
                            else change((p) => setValueAt(p, current.key, spec.key, timeRef.current, valuesAt(p, current.key, timeRef.current)[spec.key]));
                          }}
                        >
                          {here ? '◆' : '◇'}
                        </button>
                        {animated ? (
                          <button
                            type="button"
                            class="button button-small button-quiet anim-unanimate"
                            title="Stop animating; keep the value at the playhead"
                            aria-label={`Stop animating ${spec.label}`}
                            onClick={() => change((p) => stopAnimating(p, current.key, spec.key, timeRef.current))}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}

          <details class="anim-panel anim-stage-settings">
            <summary class="pane-title">{level ? 'Clip stage' : 'Stage'}</summary>
            <div class="anim-props">
              {(['width', 'height'] as const).map((side) => (
                <label key={side} class="anim-field">
                  <span class="control-label">{side === 'width' ? 'Width' : 'Height'}</span>
                  <input
                    type="number"
                    class="input input-number"
                    min={16}
                    max={side === 'width' ? 7680 : 4320}
                    value={project.stage[side]}
                    onChange={(e) => {
                      const n = Math.round(Number(e.currentTarget.value));
                      if (n >= 16 && n <= (side === 'width' ? 7680 : 4320)) change((p) => ({ ...p, stage: { ...p.stage, [side]: n } }));
                    }}
                  />
                </label>
              ))}
              <label class="anim-field">
                <span class="control-label">{level ? 'Background (while editing only)' : 'Background'}</span>
                <input type="color" value={project.stage.background} onChange={(e) => change((p) => ({ ...p, stage: { ...p.stage, background: e.currentTarget.value } }))} />
              </label>
              {!level && (
                <label class="anim-field">
                  <span class="control-label">Project name</span>
                  <input
                    class="input"
                    value={project.name}
                    onChange={(e) => {
                      const n = e.currentTarget.value.trim().slice(0, 32);
                      if (n.length >= 3) change((p) => ({ ...p, name: n }));
                    }}
                  />
                </label>
              )}
            </div>
          </details>
        </aside>
      </div>

      <div class="anim-timeline" data-testid="anim-timeline">
        <div class="anim-transport" role="toolbar" aria-label="Playback">
          <button type="button" class="button button-small button-primary" onClick={play} data-testid="anim-play" aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" class="button button-small" onClick={() => seek(0)} aria-label="Back to the start">
            <Icon name="left" size={14} /> Start
          </button>
          <button
            type="button"
            class="button button-small button-quiet"
            title="Previous keyframe"
            aria-label="Previous keyframe"
            onClick={() => {
              const prev = [...times].reverse().find((t) => t < time - 1e-6);
              seek(prev ?? 0);
            }}
          >
            ◆‹
          </button>
          <button
            type="button"
            class="button button-small button-quiet"
            title="Next keyframe"
            aria-label="Next keyframe"
            onClick={() => {
              const next = times.find((t) => t > time + 1e-6);
              seek(next ?? length);
            }}
          >
            ›◆
          </button>
          <span class="anim-clock" data-testid="anim-clock" aria-live="off">
            {fmt(time)} / {fmt(length)}
          </span>
          <label class="anim-field-inline">
            <span class="control-label">Length (s)</span>
            <input
              type="number"
              class="input input-number"
              min={0.1}
              max={600}
              step={0.5}
              value={length}
              data-testid="anim-length"
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                if (n > 0) {
                  change((p) => setLength(p, n));
                  setTime((t) => Math.min(t, n));
                }
              }}
            />
          </label>
          <label class="anim-field-inline">
            <span class="control-label">Frames per second</span>
            <select class="select select-small" value={String(fps)} onChange={(e) => change((p) => setFps(p, Number(e.currentTarget.value)))}>
              {[12, 24, 25, 30, 50, 60].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              {![12, 24, 25, 30, 50, 60].includes(fps) && <option value={fps}>{fps}</option>}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" checked={state.loop} onChange={(e) => setState((s) => ({ ...s, loop: e.currentTarget.checked }))} /> Loop
          </label>
          {!level &&
            (root.audio ? (
              <span class="anim-sound-tools">
                <span class="tone-muted" data-testid="anim-sound-name">
                  {root.audio.name}
                  {sound ? ` · ${fmt(sound.buffer.duration)}` : ''}
                </span>
                {sound && Math.abs(sound.buffer.duration - length) > 0.01 && (
                  <button
                    type="button"
                    class="button button-small button-quiet"
                    title="Make the animation as long as the sound"
                    data-testid="anim-sound-fit"
                    onClick={() => {
                      stop();
                      const seconds = clamp(Math.round(sound.buffer.duration * 100) / 100, 0.1, 600);
                      change((p) => setLength(p, seconds));
                      setTime((t) => Math.min(t, seconds));
                    }}
                  >
                    Fit the length to the sound
                  </button>
                )}
                <button
                  type="button"
                  class="button button-small button-quiet"
                  data-testid="anim-sound-remove"
                  onClick={() => {
                    stop();
                    change((p) => {
                      const { audio: _audio, ...rest } = p;
                      return rest;
                    });
                  }}
                >
                  <Icon name="trash" size={13} /> Remove sound
                </button>
              </span>
            ) : (
              <button type="button" class="button button-small" onClick={addSound} title="A soundtrack that plays in step with the animation" data-testid="anim-sound-add">
                Add sound…
              </button>
            ))}
          <span class="anim-undo">
            <button type="button" class="button button-small button-quiet" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button type="button" class="button button-small button-quiet" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
          </span>
        </div>

        {selected && selectedKeyframe && (
          <div class="anim-keybar" data-testid="anim-keybar">
            <span>
              Keyframe: <strong>{selected.key}</strong> · {PROPS.find((p) => p.key === selected.prop)?.label} at {fmt(selectedKeyframe.position)}
            </span>
            <label class="anim-field-inline">
              <span class="control-label">Easing to the next keyframe</span>
              <select
                class="select select-small"
                value={selectedEasing}
                disabled={!selectedEasing}
                data-testid="anim-easing"
                onChange={(e) => {
                  const choice = e.currentTarget.value;
                  if (choice === 'Hold') change((p) => setEasing(p, selected.key, selected.prop, selected.id, 'hold'));
                  else if (EASINGS[choice]) change((p) => setEasing(p, selected.key, selected.prop, selected.id, EASINGS[choice] as Curve));
                }}
              >
                {!selectedEasing && <option value="">(last keyframe)</option>}
                {Object.keys(EASINGS).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value="Hold">Hold (jump at the next keyframe)</option>
                {selectedEasing === 'Custom' && <option value="Custom">Custom</option>}
              </select>
            </label>
            <button
              type="button"
              class="button button-small button-quiet"
              onClick={() => {
                change((p) => removeKeyframe(p, selected.key, selected.prop, selected.id));
                setSelected(null);
              }}
            >
              <Icon name="trash" size={13} /> Delete keyframe
            </button>
          </div>
        )}

        <div class="anim-tracks">
          <div class="anim-row anim-ruler-row">
            <span class="anim-row-label tone-muted">Time</span>
            <div class="anim-lane anim-ruler" onPointerDown={scrub} data-testid="anim-ruler">
              {ticks.map((t) => (
                <span key={t} class="anim-tick" style={{ left: percent(t) }}>
                  {Number.isInteger(t) ? `${t}s` : ''}
                </span>
              ))}
              <span class="anim-playhead" style={{ left: percent(time) }} />
            </div>
          </div>
          {!level && root.audio && (
            <div class="anim-row anim-sound-row" data-testid="anim-sound">
              <span class="anim-row-label tone-muted" title={root.audio.name}>
                Sound
              </span>
              <div class="anim-lane anim-sound-lane" onPointerDown={scrub}>
                <canvas ref={wave} class="anim-wave" width={1200} height={44} role="img" aria-label="Waveform of the sound" data-ready={sound ? 'yes' : 'no'} />
                <span class="anim-playhead" style={{ left: percent(time) }} />
              </div>
            </div>
          )}
          {listed.map(({ o, depth }) => {
            const props = PROPS.filter((p) => trackOf(project, o.key, p.key));
            const clip = o.kind === 'clip' && o.clip ? root.clips?.[o.clip] : undefined;
            const clipStart = o.start ?? 0;
            const clipEnd = clip ? (o.loop ? length : Math.min(length, clipStart + sequenceOf(clip).length / (o.speed ?? 1))) : 0;
            return (
              <div key={o.key} class={`anim-rows${o.key === chosen ? ' is-chosen' : ''}`}>
                <div class="anim-row anim-object-row">
                  <button type="button" class="link-button anim-row-label" style={depth ? { paddingLeft: `${depth * 12}px` } : undefined} onClick={() => setChosen(o.key)}>
                    {o.key}
                  </button>
                  <div class="anim-lane" onPointerDown={scrub}>
                    {clip && clipEnd > clipStart && (
                      <span
                        class={`anim-clip-bar${o.loop ? ' is-loop' : ''}`}
                        style={{ left: percent(clipStart), width: `${((clipEnd - Math.min(clipStart, length)) / length) * 100}%` }}
                        title="Drag to change when the clip starts"
                        onPointerDown={(e) => dragClip(e, o)}
                        data-testid={`anim-clipbar-${o.key}`}
                      >
                        {o.clip}
                      </span>
                    )}
                    {props.length === 0 && !clip && <span class="anim-lane-note tone-muted">Not animated</span>}
                    <span class="anim-playhead" style={{ left: percent(time) }} />
                  </div>
                </div>
                {props.map((spec) => {
                  const track = trackOf(project, o.key, spec.key);
                  return (
                    <div key={spec.key} class="anim-row">
                      <span class="anim-row-label anim-row-prop">{spec.label}</span>
                      <div class="anim-lane" onPointerDown={scrub}>
                        {track?.keyframes.map((k, i) => {
                          const next = track.keyframes[i + 1];
                          return next ? (
                            <span
                              key={`seg-${k.id}`}
                              class={`anim-segment${k.type === 'hold' || !k.connectedRight ? ' is-hold' : ''}`}
                              style={{ left: percent(k.position), width: `${((Math.min(next.position, length) - Math.min(k.position, length)) / length) * 100}%` }}
                            />
                          ) : null;
                        })}
                        {track?.keyframes.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            class={`anim-diamond${selected?.id === k.id ? ' is-selected' : ''}`}
                            style={{ left: percent(k.position) }}
                            aria-label={`${o.key} ${spec.label} keyframe at ${fmt(k.position)}`}
                            aria-pressed={selected?.id === k.id}
                            onPointerDown={(e) => dragKeyframe(e, o.key, spec.key, k)}
                            onKeyDown={(e) => keyframeKeys(e, o.key, spec.key, k)}
                            onClick={() => {
                              setSelected({ key: o.key, prop: spec.key, id: k.id });
                              setChosen(o.key);
                            }}
                            data-testid={`anim-kf-${o.key}-${spec.key}`}
                          />
                        ))}
                        <span class="anim-playhead" style={{ left: percent(time) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p class="control-help">
          Space plays and pauses, Home and End jump to the ends, Ctrl+Z undoes. Drag objects on the stage, and keyframes along their row (arrow keys move a selected keyframe by a frame). An object on
          a motion path is moved along it by “Along the path”; dragging it moves the whole path. Playback runs on Theatre.js; “Theatre.js state” saves a file for `getProject(name, {'{'} state {'}'})`
          in your own code, where paths, groups, clips and sound are yours to apply.
        </p>
      </div>
    </section>
  );
}

export default defineCustomTool(AnimationStudio);
