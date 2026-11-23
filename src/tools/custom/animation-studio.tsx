/**
 * Animation Studio: motion design with Theatre.js.  Shapes, text and
 * pictures on a stage; any prop can be keyframed on a timeline with easing;
 * playback runs on @theatre/core.  Projects save as Theatre.js state (for
 * `getProject(name, { state })` in your own code), as the editor's own file,
 * or as a web page that plays the animation offline.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type AnimObject,
  type AnimProject,
  addObject,
  animate,
  animationHtml,
  type Curve,
  codeSample,
  coreConfig,
  EASINGS,
  easingOf,
  emptyProject,
  hexToRgba,
  type Keyframe,
  keyframeAt,
  keyframeTimes,
  moveKeyframe,
  objectStyle,
  PROPS,
  type PropKey,
  type PropValues,
  projectFile,
  type Rgba,
  readProjectFile,
  removeKeyframe,
  removeObject,
  renameObject,
  reorderObject,
  rgbaToHex,
  SHAPE_LABELS,
  type ShapeKind,
  sampleProject,
  sequenceOf,
  setEasing,
  setFps,
  setLength,
  setValueAt,
  snap,
  stopAnimating,
  theatreStateFile,
  trackOf,
  updateObject,
  valuesAt,
} from '../../lib/animation';
import { copyText, pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { clamp, nudge, startDrag, usePersistentState } from './_shared';

interface StudioState {
  readonly project: AnimProject;
  readonly loop: boolean;
}

/** Projects with big pictures are not kept between sessions; they belong in a file. */
const MAX_DRAFT = 400_000;

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
  const text = projectFile(s.project);
  return { project: text.length > MAX_DRAFT ? '' : text, loop: s.loop };
};

type Selected = { readonly key: string; readonly prop: PropKey; readonly id: string } | null;

const fmt = (t: number) => `${t.toFixed(2)} s`;
const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Number(n.toFixed(3)).toString());

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
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

let playCount = 0;

function AnimationStudio({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readStudio, writeStudio);
  const project = state.project;
  // The last frame first: it shows the finished scene (Play starts again from the beginning).
  const [time, setTime] = useState(() => sequenceOf(state.project).length);
  const [chosen, setChosen] = useState<string | null>(() => project.objects[0]?.key ?? null);
  const [selected, setSelected] = useState<Selected>(null);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState<Record<string, PropValues> | null>(null);
  const [scale, setScale] = useState(0.5);
  const [name, setName] = useState('');
  const history = useRef<{ past: AnimProject[]; future: AnimProject[] }>({ past: [], future: [] });
  const stageBox = useRef<HTMLDivElement>(null);
  const player = useRef<{ stop: () => void } | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const timeRef = useRef(time);
  timeRef.current = time;

  const sequence = sequenceOf(project);
  const length = sequence.length;
  const fps = sequence.subUnitsPerUnit;
  const current = chosen ? project.objects.find((o) => o.key === chosen) : undefined;

  /** Changes the project; `step` starts a new undo step (a drag is one step, not one per move). */
  const change = (next: AnimProject | ((p: AnimProject) => AnimProject), step = true) => {
    const before = projectRef.current;
    const after = typeof next === 'function' ? next(before) : next;
    if (after === before) return;
    if (step) {
      history.current.past.push(before);
      if (history.current.past.length > 100) history.current.past.shift();
      history.current.future = [];
    }
    projectRef.current = after;
    setState((s) => ({ ...s, project: after }));
  };

  const undo = () => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(projectRef.current);
    projectRef.current = previous;
    setState((s) => ({ ...s, project: previous }));
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(projectRef.current);
    projectRef.current = next;
    setState((s) => ({ ...s, project: next }));
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

  useEffect(() => () => player.current?.stop(), []);

  const stop = () => {
    player.current?.stop();
    player.current = null;
  };

  /** Plays the sequence with @theatre/core, which then draws every frame. */
  const play = () =>
    attempt(async () => {
      if (player.current) {
        stop();
        return;
      }
      const { getProject, onChange, types } = await import('@theatre/core');
      const snapshot = projectRef.current;
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
      const start = timeRef.current >= length - 1e-6 ? 0 : timeRef.current;
      sheet.sequence.position = start;
      const finished = await sheet.sequence.play({ iterationCount: state.loop ? Number.POSITIVE_INFINITY : 1, range: [0, length] });
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

  /* ------------------------------------------------------------ files -- */

  const open = () =>
    attempt(async () => {
      const [file] = await pickFiles('.json,application/json');
      if (!file) return;
      const next = readProjectFile(await file.text());
      stop();
      history.current = { past: [], future: [] };
      setState((s) => ({ ...s, project: next }));
      setChosen(next.objects[0]?.key ?? null);
      setSelected(null);
      setTime(0);
      setName(file.name.replace(/\.theatre\.json$|\.json$/i, ''));
      notify(`Opened ${file.name}`);
    });

  const baseName = () =>
    (name || project.name)
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80) || 'animation';

  const save = (format: 'project' | 'state' | 'html') =>
    attempt(async () => {
      let outcome: Awaited<ReturnType<typeof saveFile>>;
      if (format === 'project') outcome = await saveFile(`${baseName()}.animation.json`, projectFile(project), 'application/json');
      else if (format === 'state') outcome = await saveFile(`${baseName()}.theatre.json`, theatreStateFile(project), 'application/json');
      else {
        const [core, dataverse, licence] = await Promise.all([
          import('../../../node_modules/@theatre/core/dist/index.js?raw').then((m) => m.default),
          import('../../../node_modules/@theatre/dataverse/dist/index.js?raw').then((m) => m.default),
          import('../../../node_modules/@theatre/core/LICENSE?raw').then((m) => m.default),
        ]);
        outcome = await saveFile(`${baseName()}.html`, animationHtml(project, { core, dataverse, licence }, { loop: state.loop }), 'text/html');
      }
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const add = (kind: ShapeKind) =>
    attempt(async () => {
      stop();
      if (kind === 'picture') {
        const [file] = await pickFiles('image/*');
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} is larger than 4 MB; make it smaller first (Image Resizer) so the project stays quick.`);
        const picture = await readAsDataUrl(file);
        const size = await imageSize(picture);
        const fit = Math.min(1, (project.stage.width * 0.5) / size.width, (project.stage.height * 0.5) / size.height);
        let created = '';
        change((p) => {
          const r = addObject(p, 'picture', { key: file.name.replace(/\.[^.]+$/, ''), picture });
          created = r.key;
          return setValueAt(setValueAt(r.project, r.key, 'width', 0, Math.round(size.width * fit)), r.key, 'height', 0, Math.round(size.height * fit));
        });
        setChosen(created);
        return;
      }
      let created = '';
      change((p) => {
        const r = addObject(p, kind, kind === 'text' ? { text: 'Your text' } : {});
        created = r.key;
        return r.project;
      });
      setChosen(created);
    });

  /* -------------------------------------------------------- shortcuts -- */

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
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

  const dragObject = (event: PointerEvent, o: AnimObject) => {
    setChosen(o.key);
    // Dragging keeps the browser from moving focus, so the arrow keys would not reach the object.
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    const surface = stageBox.current;
    if (!surface) return;
    stop();
    const startValues = valuesAt(projectRef.current, o.key, timeRef.current);
    const origin = { x: event.clientX, y: event.clientY };
    let first = true;
    startDrag(event, surface, (_fx, _fy, e) => {
      const dx = (e.clientX - origin.x) / scale;
      const dy = (e.clientY - origin.y) / scale;
      if (first && Math.abs(dx) + Math.abs(dy) < 2 / scale) return;
      change((p) => setValueAt(setValueAt(p, o.key, 'x', timeRef.current, Math.round((startValues.x as number) + dx)), o.key, 'y', timeRef.current, Math.round((startValues.y as number) + dy)), first);
      first = false;
    });
  };

  const nudgeObject = (e: KeyboardEvent, o: AnimObject) => {
    const step = nudge(e);
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const v = valuesAt(projectRef.current, o.key, timeRef.current);
    change((p) => setValueAt(setValueAt(p, o.key, 'x', timeRef.current, (v.x as number) + step.dx), o.key, 'y', timeRef.current, (v.y as number) + step.dy));
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

  const percent = (t: number) => `${(clamp(t, 0, length) / length) * 100}%`;
  const values = current ? at(current.key) : null;

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
            stop();
            const sample = sampleProject();
            change(sample);
            setChosen('Ball');
            setSelected(null);
            setTime(sequenceOf(sample).length);
            setName('');
          }}
        >
          <Icon name="sample" size={15} /> Sample
        </button>
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() => {
            stop();
            change(emptyProject());
            setChosen(null);
            setSelected(null);
            setTime(0);
            setName('');
          }}
        >
          <Icon name="plus" size={15} /> New
        </button>
        <span class="anim-add" role="group" aria-label="Add">
          <span class="control-label">Add</span>
          {(['box', 'ellipse', 'text', 'picture'] as const).map((kind) => (
            <button key={kind} type="button" class="button button-small" onClick={() => add(kind)} data-testid={`anim-add-${kind}`}>
              {SHAPE_LABELS[kind]}
            </button>
          ))}
        </span>
        <span class="anim-save" role="group" aria-label="Save">
          <span class="control-label">Save as</span>
          <button type="button" class="button button-small" onClick={() => save('html')} data-testid="anim-html">
            Web page
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
                await copyText(codeSample(project));
                notify('Code for @theatre/core copied');
              })
            }
          >
            <Icon name="copy" size={13} /> Code
          </button>
        </span>
      </div>

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
            {project.objects.map((o) => {
              const v = at(o.key);
              const style = objectStyle(o.kind, v);
              return (
                <div
                  key={o.key}
                  role="button"
                  tabIndex={0}
                  aria-label={o.kind === 'text' ? `${o.text ?? ''} (${o.key})` : `${o.key} (${SHAPE_LABELS[o.kind].toLowerCase()})`}
                  aria-pressed={o.key === chosen}
                  class={`anim-obj anim-${o.kind}${o.key === chosen ? ' is-chosen' : ''}`}
                  style={{ ...style, ...(o.kind === 'picture' && o.picture ? { backgroundImage: `url("${o.picture}")` } : {}) }}
                  onPointerDown={(e) => dragObject(e, o)}
                  onKeyDown={(e) => nudgeObject(e, o)}
                  onFocus={() => setChosen(o.key)}
                  data-testid={`anim-obj-${o.key}`}
                >
                  {o.kind === 'text' ? o.text : null}
                </div>
              );
            })}
            {project.objects.length === 0 && <p class="anim-empty">Add a box, an ellipse, text or a picture to start.</p>}
          </div>
        </div>

        <aside class="anim-side" aria-label="Objects and props">
          <div class="anim-panel">
            <div class="anim-panel-head">
              <span class="pane-title">Objects</span>
              <span class="tone-muted">later ones are drawn on top</span>
            </div>
            <ul class="anim-objects" data-testid="anim-objects">
              {project.objects.map((o) => (
                <li key={o.key} class={o.key === chosen ? 'is-chosen' : ''}>
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
                      title="Delete"
                      aria-label={`Delete ${o.key}`}
                      onClick={() => {
                        stop();
                        change((p) => removeObject(p, o.key));
                        if (chosen === o.key) setChosen(null);
                        if (selected?.key === o.key) setSelected(null);
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
              <p class="control-help anim-help">Values are at {fmt(time)}. ◇ starts animating a prop; then any change you make adds a keyframe at the playhead.</p>
              <div class="anim-props">
                {PROPS.filter((spec) => !spec.only || spec.only.includes(current.kind)).map((spec) => {
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
                })}
              </div>
            </div>
          )}

          <details class="anim-panel anim-stage-settings">
            <summary class="pane-title">Stage</summary>
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
                <span class="control-label">Background</span>
                <input type="color" value={project.stage.background} onChange={(e) => change((p) => ({ ...p, stage: { ...p.stage, background: e.currentTarget.value } }))} />
              </label>
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
          {project.objects.map((o) => {
            const props = PROPS.filter((p) => trackOf(project, o.key, p.key));
            return (
              <div key={o.key} class={`anim-group${o.key === chosen ? ' is-chosen' : ''}`}>
                <div class="anim-row anim-object-row">
                  <button type="button" class="link-button anim-row-label" onClick={() => setChosen(o.key)}>
                    {o.key}
                  </button>
                  <div class="anim-lane" onPointerDown={scrub}>
                    {props.length === 0 && <span class="anim-lane-note tone-muted">Not animated</span>}
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
          Space plays and pauses, Home and End jump to the ends, Ctrl+Z undoes. Drag objects on the stage, and keyframes along their row (arrow keys move a selected keyframe by a frame). Playback runs
          on Theatre.js; “Theatre.js state” saves a file for `getProject(name, {'{'} state {'}'})` in your own code.
        </p>
      </div>
    </section>
  );
}

export default defineCustomTool(AnimationStudio);
