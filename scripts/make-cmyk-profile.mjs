#!/usr/bin/env node
/**
 * Makes the CMYK printing profile that ships with the app
 * (public/icc/Benchtop-Coated-FOGRA39L.icc) from the FOGRA39L characterisation
 * data: 1617 measured patches of sheet-fed offset printing on coated paper
 * (ISO 12647-2), the data set most printers in Europe and Asia mean by
 * "FOGRA39" or "ISO Coated v2".
 *
 * A profile needs two things the measurements do not give directly:
 *
 *  - the colour of any mix of the four inks, not only the measured ones.
 *    The patches hold full grids of cyan, magenta and yellow at six levels of
 *    black; between them the colour is worked out as the Yule-Nielsen form of
 *    Neugebauer's model does (straight lines between measured neighbours, in
 *    the square root of XYZ, along each ink's measured tone curve);
 *
 *  - the inks for any colour, which has many answers (grey can be made of
 *    three colours, or of black).  Here black comes in from the quarter tones
 *    down, the four inks together never exceed 300 %, and a colour the press
 *    cannot print becomes the nearest one of the same hue that it can.
 *
 * The result is an ICC version 2 printer profile with tables for every
 * rendering intent.  Run `node scripts/make-cmyk-profile.mjs` to write it
 * again; the same data always gives the same bytes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const D50 = [0.9642, 1.0, 0.8249];
/** The Yule-Nielsen exponent: how much light spreads in the paper between the dots. */
const YN = 2;
/** The most ink the four plates may lay down together, as a share of one solid. */
export const INK_LIMIT = 3.0;

/* ----------------------------------------------------------- data -- */

/** The measured patches of a CGATS file: inks from 0 to 1, XYZ with Y of the perfect white as 1. */
export function readPatches(text) {
  const format = /BEGIN_DATA_FORMAT\s+([^\n]+)\s+END_DATA_FORMAT/.exec(text)?.[1].trim().split(/\s+/);
  const body = /BEGIN_DATA\n([\s\S]*?)END_DATA/.exec(text)?.[1];
  if (!format || !body) throw new Error('This is not CGATS characterisation data.');
  const at = (name) => {
    const index = format.indexOf(name);
    if (index < 0) throw new Error(`The data has no ${name} column.`);
    return index;
  };
  const columns = ['CMYK_C', 'CMYK_M', 'CMYK_Y', 'CMYK_K', 'XYZ_X', 'XYZ_Y', 'XYZ_Z'].map(at);
  const byInk = new Map();
  for (const line of body.trim().split('\n')) {
    const cells = line.trim().split(/\s+/).map(Number);
    const [c, m, y, k, X, Y, Z] = columns.map((index) => cells[index] / 100);
    const key = `${c},${m},${y},${k}`;
    const seen = byInk.get(key);
    // A patch measured twice counts once, as the mean.
    if (seen) {
      seen.sum = seen.sum.map((value, i) => value + [X, Y, Z][i]);
      seen.count += 1;
    } else byInk.set(key, { ink: [c, m, y, k], sum: [X, Y, Z], count: 1 });
  }
  return [...byInk.values()].map(({ ink, sum, count }) => ({ ink, xyz: sum.map((value) => value / count) }));
}

/* --------------------------------------------------------- colour -- */

const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const fInverse = (t) => (t > 6 / 29 ? t ** 3 : (116 * t - 16) / (24389 / 27));
/** XYZ (relative to D50) to L*a*b*. */
export const labOf = ([X, Y, Z]) => {
  const [fx, fy, fz] = [f(X / D50[0]), f(Y / D50[1]), f(Z / D50[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
export const xyzOf = ([L, a, b]) => {
  const fy = (L + 16) / 116;
  return [D50[0] * fInverse(fy + a / 500), D50[1] * fInverse(fy), D50[2] * fInverse(fy - b / 200)];
};
export const deltaE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * XYZ (relative to D50) in Oklab, times a hundred: a space in which a colour that loses
 * strength keeps the hue the eye sees (in L*a*b* a blue turns purple on the way to grey).
 * Used only to decide which printable colour is "nearest" one the press cannot print.
 */
export const oklabOf = ([X, Y, Z], out = [0, 0, 0]) => {
  // To D65, which Oklab is defined for (Bradford).
  const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z;
  const y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z;
  const z = 0.0122982 * X - 0.020483 * Y + 1.3299098 * Z;
  const l = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z);
  const m = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z);
  const n = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z);
  out[0] = 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * n);
  out[1] = 100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * n);
  out[2] = 100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * n);
  return out;
};

/** A curve through points that never overshoots (Fritsch and Carlson): x rising, y rising or level. */
export function monotoneCurve(xs, ys) {
  const n = xs.length;
  const slopes = [];
  for (let i = 0; i < n - 1; i++) slopes.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const tangents = [slopes[0]];
  for (let i = 1; i < n - 1; i++) tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  tangents.push(slopes[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const size = a * a + b * b;
    if (size > 9) {
      const scale = 3 / Math.sqrt(size);
      tangents[i] = scale * a * slopes[i];
      tangents[i + 1] = scale * b * slopes[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h * tangents[i] + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h * tangents[i + 1];
  };
}

/* -------------------------------------------------- the press model -- */

/**
 * The colour the press gives for any four inks.  Returns `xyz(c, m, y, k)`: XYZ relative to
 * the paper (the bare paper is D50), which is how a profile's tables describe colour.
 */
export function pressModel(patches) {
  const key = (ink) => ink.map((value) => Math.round(value * 1000)).join(',');
  const measured = new Map(patches.map((patch) => [key(patch.ink), patch.xyz]));
  const paper = measured.get(key([0, 0, 0, 0]));
  if (!paper) throw new Error('The data has no patch of bare paper.');
  // In the space the model is straight in: the square root of paper-relative XYZ.
  const spread = (xyz) => xyz.map((value, i) => ((value / paper[i]) * D50[i]) ** (1 / YN));
  const node = (ink) => {
    const xyz = measured.get(key(ink));
    return xyz ? spread(xyz) : null;
  };

  // Each level of black that holds a full grid of the three colours, finest grid first.
  const candidates = [
    [0, 0.1, 0.2, 0.3, 0.4, 0.55, 0.7, 0.85, 1],
    [0, 0.1, 0.2, 0.4, 0.7, 1],
    [0, 0.2, 0.4, 0.7, 1],
    [0, 0.4, 0.7, 1],
    [0, 0.4, 1],
    [0, 1],
  ];
  const blacks = [...new Set(patches.map((patch) => patch.ink[3]))].sort((a, b) => a - b);
  const levels = [];
  for (const k of blacks) {
    const axis = candidates.find((steps) => steps.every((c) => steps.every((m) => steps.every((y) => measured.has(key([c, m, y, k]))))));
    if (!axis || (axis.length < 3 && k !== 1)) continue;
    const n = axis.length;
    const grid = new Float64Array(n * n * n * 3);
    for (const [ci, c] of axis.entries()) {
      for (const [mi, m] of axis.entries()) {
        for (const [yi, y] of axis.entries()) {
          grid.set(node([c, m, y, k]), ((ci * n + mi) * n + yi) * 3);
        }
      }
    }
    levels.push({ k, axis, n, grid });
  }
  if (levels.length < 2 || levels[0].k !== 0 || levels[levels.length - 1].k !== 1) throw new Error('The data lacks full grids at no black and at solid black.');

  /**
   * How far an ink has got from none to solid, by the colour of its own scale on paper:
   * the model's straight lines run along this, not along the dot percentage (dots gain).
   */
  const coverage = (index) => {
    const steps = [...new Set(patches.filter((patch) => patch.ink.every((value, i) => i === index || value === 0)).map((patch) => patch.ink[index]))].sort((a, b) => a - b);
    const solid = [0, 0, 0, 0];
    solid[index] = 1;
    const from = node([0, 0, 0, 0]);
    const to = node(solid);
    const line = to.map((value, i) => value - from[i]);
    const length = line.reduce((sum, value) => sum + value * value, 0);
    const covered = steps.map((step) => {
      const ink = [0, 0, 0, 0];
      ink[index] = step;
      const at = node(ink);
      return at.reduce((sum, value, i) => sum + (value - from[i]) * line[i], 0) / length;
    });
    // Measurement noise must not make the curve turn back.
    for (let i = 1; i < covered.length; i++) covered[i] = Math.max(covered[i], covered[i - 1] + 1e-6);
    return monotoneCurve(steps, covered);
  };
  const cover = [0, 1, 2, 3].map(coverage);

  const at = new Float64Array(3);
  const low = new Float64Array(3);
  const high = new Float64Array(3);
  /** The colour at one level of black, into `out`: straight between the eight grid neighbours. */
  const onLevel = (level, covered, out) => {
    const { n, grid } = level;
    const base = [0, 0, 0];
    const share = [0, 0, 0];
    for (let d = 0; d < 3; d++) {
      const value = covered[d];
      let i = 0;
      while (i < n - 2 && value > level.covered[d][i + 1]) i++;
      const from = level.covered[d][i];
      const to = level.covered[d][i + 1];
      base[d] = i;
      share[d] = Math.min(1, Math.max(0, (value - from) / (to - from)));
    }
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let corner = 0; corner < 8; corner++) {
      const ci = base[0] + (corner & 1);
      const mi = base[1] + ((corner >> 1) & 1);
      const yi = base[2] + ((corner >> 2) & 1);
      const weight = (corner & 1 ? share[0] : 1 - share[0]) * ((corner >> 1) & 1 ? share[1] : 1 - share[1]) * ((corner >> 2) & 1 ? share[2] : 1 - share[2]);
      if (weight === 0) continue;
      const offset = ((ci * n + mi) * n + yi) * 3;
      out[0] += weight * grid[offset];
      out[1] += weight * grid[offset + 1];
      out[2] += weight * grid[offset + 2];
    }
  };
  for (const level of levels) level.covered = [0, 1, 2].map((d) => level.axis.map((step) => cover[d](step)));
  const blackCovered = levels.map((level) => cover[3](level.k));

  const xyz = (c, m, y, k, out = [0, 0, 0]) => {
    const covered = [cover[0](c), cover[1](m), cover[2](y)];
    const black = cover[3](k);
    let i = 0;
    while (i < levels.length - 2 && black > blackCovered[i + 1]) i++;
    const share = Math.min(1, Math.max(0, (black - blackCovered[i]) / (blackCovered[i + 1] - blackCovered[i])));
    onLevel(levels[i], covered, low);
    if (share > 0) onLevel(levels[i + 1], covered, high);
    for (let d = 0; d < 3; d++) {
      at[d] = share > 0 ? low[d] + (high[d] - low[d]) * share : low[d];
      out[d] = Math.max(0, at[d]) ** YN;
    }
    return out;
  };
  return {
    xyz,
    paper,
    levels: levels.map((level) => ({ k: level.k, steps: level.axis })),
    cover,
    used: (ink) => levels.some((level) => level.k === ink[3] && ink.slice(0, 3).every((value) => level.axis.includes(value))),
  };
}

/* ------------------------------------------------- the separation -- */

const clamp = (value) => Math.min(1, Math.max(0, value));

/**
 * With the black fixed, finds the three colours whose print is nearest a wanted L*a*b*.
 * "Nearest" counts a change of hue as worse than a change of lightness or of strength, so
 * a colour the press cannot reach keeps its hue and gives up strength.  The three colours
 * are held to what the ink limit leaves beside the black.  Starts from `start`, a guess,
 * and returns the colours, the inks they make and how far off the print is.
 */
export function colourSolver(model, weights = { L: 1, C: 2, H: 6, grey: 30 }) {
  const xyz = [0, 0, 0];
  const ink = [0, 0, 0, 0];
  const at = [0, 0, 0];
  const inksOf = (x, k, out) => {
    const colours = x[0] + x[1] + x[2];
    const fit = colours + k > INK_LIMIT ? (INK_LIMIT - k) / colours : 1;
    out[0] = x[0] * fit;
    out[1] = x[1] * fit;
    out[2] = x[2] * fit;
    out[3] = k;
    return out;
  };
  return function solve(target, k, start) {
    // The wanted colour as the eye orders colours; its strength runs along, its hue across.
    // (A table has steps for "colours" darker than black with a tint, which no light makes:
    // those are taken as the nearest that exists, and a grey is taken as exactly grey, since
    // close to black the smallest tint in the numbers would otherwise read as a hue to keep.)
    const grey = Math.hypot(target[1], target[2]) < 0.5;
    const wanted = oklabOf(xyzOf(grey ? [target[0], 0, 0] : target).map((value) => Math.max(0, value)));
    const chroma = Math.hypot(wanted[1], wanted[2]);
    const along = chroma > 1e-6 ? [wanted[1] / chroma, wanted[2] / chroma] : [1, 0];
    // A grey must stay grey: near the grey axis a tint in any direction counts, and counts for much.
    const coloured = clamp(chroma / 4);
    const strength = weights.grey + (weights.C - weights.grey) * coloured;
    const hue = weights.grey + (weights.H - weights.grey) * coloured;
    const residual = (x, out) => {
      oklabOf(model.xyz(...inksOf(x, k, ink), xyz), at);
      const da = at[1] - wanted[1];
      const db = at[2] - wanted[2];
      out[0] = weights.L * (at[0] - wanted[0]);
      out[1] = strength * (da * along[0] + db * along[1]);
      out[2] = hue * (-da * along[1] + db * along[0]);
      return out[0] * out[0] + out[1] * out[1] + out[2] * out[2];
    };
    // Colours that add up to more than the ink limit leaves are scaled back to it when printed,
    // so many sets of three stand for the same inks; the search keeps to the set that needs no
    // scaling, where a small step in one colour is a small step in that ink and nothing else.
    const within = (x) => {
      const colours = x[0] + x[1] + x[2];
      const fit = colours + k > INK_LIMIT ? (INK_LIMIT - k) / colours : 1;
      return [x[0] * fit, x[1] * fit, x[2] * fit];
    };
    let x = within([clamp(start[0]), clamp(start[1]), clamp(start[2])]);
    let r = [0, 0, 0];
    let cost = residual(x, r);
    let damping = 1e-3;
    const J = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    const trial = [0, 0, 0];
    const rt = [0, 0, 0];
    for (let round = 0; round < 40 && cost > 1e-9; round++) {
      // How the print changes with each colour, by trying a small step (inwards at an edge).
      for (let d = 0; d < 3; d++) {
        const h = x[d] > 0.5 ? -1e-4 : 1e-4;
        trial[0] = x[0];
        trial[1] = x[1];
        trial[2] = x[2];
        trial[d] += h;
        residual(trial, rt);
        for (let e = 0; e < 3; e++) J[e][d] = (rt[e] - r[e]) / h;
      }
      const gradient = [0, 1, 2].map((d) => J[0][d] * r[0] + J[1][d] * r[1] + J[2][d] * r[2]);
      // A colour already at none or at solid that wants to go further stays put.
      const free = [0, 1, 2].filter((d) => !((x[d] <= 0 && gradient[d] > 0) || (x[d] >= 1 && gradient[d] < 0)));
      if (free.length === 0) break;
      let moved = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const n = free.length;
        const A = free.map((p) => free.map((q) => J[0][p] * J[0][q] + J[1][p] * J[1][q] + J[2][p] * J[2][q]));
        for (let p = 0; p < n; p++) A[p][p] = A[p][p] * (1 + damping) + 1e-12;
        const b = free.map((p) => -gradient[p]);
        // Gaussian elimination: three unknowns at most.
        for (let p = 0; p < n; p++) {
          let pivot = p;
          for (let q = p + 1; q < n; q++) if (Math.abs(A[q][p]) > Math.abs(A[pivot][p])) pivot = q;
          [A[p], A[pivot]] = [A[pivot], A[p]];
          [b[p], b[pivot]] = [b[pivot], b[p]];
          for (let q = p + 1; q < n; q++) {
            const factor = A[q][p] / A[p][p];
            for (let col = p; col < n; col++) A[q][col] -= factor * A[p][col];
            b[q] -= factor * b[p];
          }
        }
        const step = new Array(n).fill(0);
        for (let p = n - 1; p >= 0; p--) {
          let sum = b[p];
          for (let q = p + 1; q < n; q++) sum -= A[p][q] * step[q];
          step[p] = sum / A[p][p];
        }
        trial[0] = x[0];
        trial[1] = x[1];
        trial[2] = x[2];
        free.forEach((d, p) => {
          trial[d] = clamp(x[d] + step[p]);
        });
        const next = residual(trial, rt);
        if (next < cost) {
          const gain = cost - next;
          x = within(trial);
          r = [rt[0], rt[1], rt[2]];
          cost = next;
          damping = Math.max(damping / 3, 1e-7);
          moved = gain > 1e-12;
          break;
        }
        damping *= 4;
      }
      if (!moved) break;
    }
    const inks = inksOf(x, k, [0, 0, 0, 0]);
    // How far the print is from the wanted colour, as a plain colour difference.
    return { x, k, cost, inks, miss: deltaE(labOf(model.xyz(...inks, xyz)), target) };
  };
}

/** A print this close to the wanted colour (ΔE) counts as that colour. */
const REACHED = 0.03;

/**
 * How much of the black a colour could carry it does carry: none in light colours, most of it
 * in the deep shadows.  A grey can be printed with three colours and no black, or with black
 * and hardly any colour, and every mix between; this picks the mix.  Black in the shadows
 * gives depth, steadier greys on press and less ink; black in light tones shows as grain.
 */
export const blackShare = (L) => 0.85 * clamp((80 - L) / 70) ** 1.3;

/**
 * The inks for a wanted L*a*b*.  Finds the least and the most black with which the press
 * prints the colour exactly, and takes the black between them that `blackShare` asks for.
 * A colour the press cannot print gets the black that brings the print nearest.
 * `hint` is the answer for a colour close by.
 */
export function separator(model) {
  const solve = colourSolver(model);
  const STEPS = 10;
  return function inksFor(target, hint = { x: [0, 0, 0], k: 0 }) {
    // The print at each of a row of blacks, each starting from the one before.
    const row = [];
    let guess = hint.x;
    for (let step = 0; step <= STEPS; step++) {
      const found = solve(target, step / STEPS, guess);
      row.push(found);
      guess = found.x;
    }
    // (And once more from the hint itself, at its own black: the best start near a neighbour.)
    const first = row.findIndex((found) => found.miss < REACHED);
    if (first < 0) {
      // Out of reach: the black that comes nearest, looked for between its neighbours in the row.
      let best = row.reduce((a, b) => (b.cost < a.cost ? b : a));
      let low = Math.max(0, best.k - 1 / STEPS);
      let high = Math.min(1, best.k + 1 / STEPS);
      for (let round = 0; round < 12 && high - low > 1e-3; round++) {
        const a = low + (high - low) * 0.382;
        const b = low + (high - low) * 0.618;
        const atA = solve(target, a, best.x);
        const atB = solve(target, b, best.x);
        if (atA.cost < atB.cost) {
          high = b;
          if (atA.cost < best.cost) best = atA;
        } else {
          low = a;
          if (atB.cost < best.cost) best = atB;
        }
      }
      return best;
    }
    let last = first;
    while (last < STEPS && row[last + 1].miss < REACHED) last++;
    // The edges of the range, found between the last black that fails and the first that works.
    const edge = (inside, outside) => {
      let good = row[inside];
      let bad = outside / STEPS;
      for (let round = 0; round < 9; round++) {
        const middle = (good.k + bad) / 2;
        const found = solve(target, middle, good.x);
        if (found.miss < REACHED) good = found;
        else bad = middle;
      }
      return good;
    };
    const least = first > 0 ? edge(first, first - 1) : row[0];
    const most = last < STEPS ? edge(last, last + 1) : row[STEPS];
    const k = least.k + (most.k - least.k) * blackShare(target[0]);
    const found = solve(target, k, row[Math.min(STEPS, Math.max(0, Math.round(k * STEPS)))].x);
    // Between two blacks that work, every black works; should the numbers disagree, the nearer edge does.
    return found.miss < REACHED * 3 ? found : least.miss <= most.miss ? least : most;
  };
}

/** The darkest grey the press prints within the ink limit, as L*: where black-point scaling ends. */
export function darkest(model) {
  const solve = colourSolver(model);
  let best = solve([0, 0, 0], 1, [0.7, 0.6, 0.6]);
  for (let k = 0.8; k <= 1.0001; k += 0.02) {
    const found = solve([0, 0, 0], Math.min(1, k), best.x);
    if (found.cost < best.cost) best = found;
  }
  return labOf(model.xyz(...best.inks))[0];
}

/**
 * Lightness scaled so that black becomes the press's black and white stays white, in XYZ
 * as black-point compensation does it: what the "perceptual" table does before it looks
 * for inks, so that shadows keep their steps where plain matching would fill them in.
 */
export function compress(lab, blackL) {
  const black = xyzOf([blackL, 0, 0]);
  const xyz = xyzOf(lab);
  return labOf(xyz.map((value, i) => black[i] + value * (1 - black[i] / D50[i])));
}

/* ----------------------------------------------------- the tables -- */

/** L*a*b* as a profile's 16-bit tables of version 2 hold it: L 100 is 0xFF00, a and b 0 are 0x8000. */
const encodeLab = (lab) => [
  Math.round(Math.min(65535, Math.max(0, lab[0] * 652.8))),
  Math.round(Math.min(65535, Math.max(0, (lab[1] + 128) * 256))),
  Math.round(Math.min(65535, Math.max(0, (lab[2] + 128) * 256))),
];

/** From inks to colour: a grid of `size` steps an ink, each ink first passed through its tone curve. */
export function inkTable(model, size = 11, entries = 256) {
  // The curves bring the grid's steps to equal steps of printed tone, where its straight lines fit best.
  const curves = model.cover.map((cover) => Uint16Array.from({ length: entries }, (_, i) => Math.round(clamp(cover(i / (entries - 1))) * 65535)));
  const dots = model.cover.map((cover) =>
    Array.from({ length: size }, (_, step) => {
      const wanted = step / (size - 1);
      let low = 0;
      let high = 1;
      for (let round = 0; round < 40; round++) {
        const middle = (low + high) / 2;
        if (cover(middle) < wanted) low = middle;
        else high = middle;
      }
      return step === 0 ? 0 : step === size - 1 ? 1 : (low + high) / 2;
    }),
  );
  const grid = new Uint16Array(size ** 4 * 3);
  let at = 0;
  for (const c of dots[0])
    for (const m of dots[1])
      for (const y of dots[2])
        for (const k of dots[3]) {
          grid.set(encodeLab(labOf(model.xyz(c, m, y, k))), at);
          at += 3;
        }
  return { size, curves, grid };
}

/**
 * From colour to inks: for every step of an L*a*b* grid, the inks that print the nearest
 * colour.  `prepare` changes the wanted colour first (the perceptual table's scaling).
 * Each answer starts from its neighbour's, working outwards from the greys, so that inks
 * change smoothly from one step to the next.
 */
/**
 * Where the steps of the colour tables lie along a* and b*: close together near the greys
 * and wider apart towards the strongest colours.  Greys, skin and pale tints are where the
 * eye is least forgiving and where the printable colours narrow to a point at the paper's
 * white; a curve at the table's entrance (`spreadCurve`) sends each colour to its place
 * between the steps.
 */
const SPREAD = 2.5;
/** From a place along the steps (0 to 1) to a* or b*. */
const tintAt = (place) => (128 * Math.sinh((2 * place - 1) * Math.asinh(SPREAD))) / SPREAD;
/** The curve at the entrance of a colour table for a* and b*, as 16-bit entries. */
export function spreadCurve(entries = 2049) {
  return Uint16Array.from({ length: entries }, (_, i) => {
    const tint = ((i / (entries - 1)) * 65535) / 256 - 128;
    return Math.round(clamp(0.5 + (0.5 * Math.asinh((SPREAD * tint) / 128)) / Math.asinh(SPREAD)) * 65535);
  });
}

export function colourTable(model, size = 33, prepare = (lab) => lab) {
  const inksFor = separator(model);
  // The grid holds each ink as printed tone (how far it has got from none to solid), which
  // runs straighter between neighbouring steps than dot percentages do; `toneCurves` at the
  // table's end turn tone back into dots.
  const tone = model.cover;
  const grid = new Uint16Array(size ** 3 * 4);
  const answers = new Array(size ** 3);
  const middle = (size - 1) / 2;
  const code = (index) => (index / (size - 1)) * 65535;
  // The steps of one lightness, greys first and then ring by ring.
  const order = [];
  for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) order.push([a, b, Math.max(Math.abs(a - middle), Math.abs(b - middle))]);
  order.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
  const toward = (index) => index + Math.sign(middle - index);
  for (let l = size - 1; l >= 0; l--) {
    for (const [a, b] of order) {
      const wanted = prepare([code(l) / 652.8, tintAt(a / (size - 1)), tintAt(b / (size - 1))]);
      const here = (l * size + a) * size + b;
      // The guess: the step nearer the greys, or for a grey the one a step lighter.
      const inner = a === toward(a) && b === toward(b) ? null : answers[(l * size + toward(a)) * size + toward(b)];
      const above = l < size - 1 ? answers[((l + 1) * size + a) * size + b] : null;
      const found = inksFor(wanted, inner ?? above ?? undefined);
      answers[here] = found;
      for (let d = 0; d < 4; d++) grid[here * 4 + d] = Math.round(clamp(tone[d](clamp(found.inks[d]))) * 65535);
    }
  }
  return { size, grid };
}

/** Curves from printed tone back to dots, one for each ink: the last step of the tables from colour to inks. */
export function toneCurves(model, entries = 1024) {
  return model.cover.map((cover) =>
    Uint16Array.from({ length: entries }, (_, i) => {
      const wanted = i / (entries - 1);
      let low = 0;
      let high = 1;
      for (let round = 0; round < 40; round++) {
        const middle = (low + high) / 2;
        if (cover(middle) < wanted) low = middle;
        else high = middle;
      }
      return i === 0 ? 0 : i === entries - 1 ? 65535 : Math.round(((low + high) / 2) * 65535);
    }),
  );
}

/* ------------------------------------------------------ the file -- */

const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0);
  return bytes;
};
const fixed = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(Math.round(value * 65536));
  return bytes;
};
const words = (values) => {
  const bytes = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++) bytes.writeUInt16BE(values[i], i * 2);
  return bytes;
};
const straight = words([0, 65535]);

const textTag = (text) => Buffer.concat([Buffer.from('text\0\0\0\0', 'latin1'), Buffer.from(`${text}\0`, 'latin1')]);
const descTag = (text) => Buffer.concat([Buffer.from('desc\0\0\0\0', 'latin1'), u32(text.length + 1), Buffer.from(`${text}\0`, 'latin1'), Buffer.alloc(4 + 4 + 2 + 1 + 67)]);
const xyzTag = (xyz) => Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), ...xyz.map(fixed)]);
/** A 16-bit table tag: curves in, a grid, curves out. */
const lutTag = (inputs, outputs, size, inCurves, grid, outCurves) =>
  Buffer.concat([
    Buffer.from('mft2\0\0\0\0', 'latin1'),
    Buffer.from([inputs, outputs, size, 0]),
    ...[1, 0, 0, 0, 1, 0, 0, 0, 1].map(fixed),
    words([inCurves[0].length / 2, outCurves[0].length / 2]),
    ...inCurves,
    words(grid),
    ...outCurves,
  ]);

/** The profile as a file. */
export function profileBytes({ description, copyright, target, paper, ink, perceptual, colorimetric, dots }) {
  const toColour = lutTag(
    4,
    3,
    ink.size,
    ink.curves.map((curve) => words(curve)),
    ink.grid,
    [straight, straight, straight],
  );
  const spread = words(spreadCurve());
  // (All the curves of one side of a table have the same number of entries: lightness gets a straight one as long.)
  const level = words(Uint16Array.from({ length: spread.length / 2 }, (_, i) => Math.round((i / (spread.length / 2 - 1)) * 65535)));
  const toInk = (table) =>
    lutTag(
      3,
      4,
      table.size,
      [level, spread, spread],
      table.grid,
      dots.map((curve) => words(curve)),
    );
  const forPictures = toInk(perceptual);
  const parts = [
    ['desc', descTag(description)],
    ['cprt', textTag(copyright)],
    ['wtpt', xyzTag(paper)],
    ['targ', textTag(target)],
    ['A2B0', toColour],
    ['A2B1', toColour],
    ['A2B2', toColour],
    ['B2A0', forPictures],
    ['B2A1', toInk(colorimetric)],
    ['B2A2', forPictures],
  ];
  // The same table under several names is stored once.
  const stored = new Map();
  const blocks = [];
  let offset = 128 + 4 + parts.length * 12;
  const table = [u32(parts.length)];
  for (const [name, data] of parts) {
    let place = stored.get(data);
    if (!place) {
      place = { offset, size: data.length };
      stored.set(data, place);
      const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
      blocks.push(padded);
      offset += padded.length;
    }
    table.push(Buffer.from(name, 'latin1'), u32(place.offset), u32(place.size));
  }
  const header = Buffer.alloc(128);
  header.writeUInt32BE(offset, 0);
  header.writeUInt32BE(0x02400000, 8);
  header.write('prtrCMYKLab ', 12, 'latin1');
  // A fixed date: the same data gives the same file.
  for (const [i, value] of [2026, 11, 24, 0, 0, 0].entries()) header.writeUInt16BE(value, 24 + i * 2);
  header.write('acsp', 36, 'latin1');
  for (const [i, value] of D50.entries()) fixed(value).copy(header, 68 + i * 4);
  return Buffer.concat([header, ...table, ...blocks]);
}

const DATA = fileURLToPath(new URL('./data/FOGRA39L.ti3', import.meta.url));
export const PROFILE = fileURLToPath(new URL('../public/icc/Benchtop-Coated-FOGRA39L.icc', import.meta.url));

/** The whole profile from the data file. */
export function makeProfile(log = () => undefined) {
  const patches = readPatches(readFileSync(DATA, 'utf8'));
  const model = pressModel(patches);
  log(`${patches.length} patches; grids at black ${model.levels.map((level) => `${Math.round(level.k * 100)} % (${level.steps.length} steps)`).join(', ')}`);
  const blackL = darkest(model);
  log(`darkest grey: L* ${blackL.toFixed(1)}`);
  const ink = inkTable(model);
  const colorimetric = colourTable(model);
  log('table for matching colours: done');
  const perceptual = colourTable(model, 33, (lab) => compress(lab, blackL));
  log('table for pictures: done');
  const bytes = profileBytes({
    description: 'Benchtop Coated FOGRA39L (300%)',
    copyright: 'No copyright, use freely (CC0 1.0). Made by Benchtop from the FOGRA39L characterization data.',
    // The name under which the data is registered with the ICC, as its registry asks of profiles made from it.
    target: 'ICCHDAT FOGRA39L',
    paper: model.paper,
    ink,
    perceptual,
    colorimetric,
    dots: toneCurves(model),
  });
  return { bytes, model, patches, blackL };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const started = Date.now();
  const { bytes, model, patches } = makeProfile((line) => console.log(line));
  // The patches the model was not built on say how well it tells colours it has not seen.
  const relative = (xyz) => labOf(xyz.map((value, i) => (value / model.paper[i]) * D50[i]));
  const errors = patches
    .filter((patch) => !model.used(patch.ink))
    .map((patch) => deltaE(labOf(model.xyz(...patch.ink)), relative(patch.xyz)))
    .sort((a, b) => b - a);
  console.log(`${errors.length} patches off the grids: mean ΔE ${(errors.reduce((sum, e) => sum + e, 0) / errors.length).toFixed(2)}, worst ${errors[0].toFixed(2)}`);
  writeFileSync(PROFILE, bytes);
  console.log(`${PROFILE}: ${bytes.length} bytes, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
