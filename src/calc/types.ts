/** The calculator library's data model: variables with units, equations, and where they apply. */
import type { Dimension } from './units';

export const CALC_CATEGORIES = [
  { id: 'finance', name: 'Finance', blurb: 'Loans, EMI, SIP, interest, returns, tax, discounts and pricing' },
  { id: 'health', name: 'Health', blurb: 'BMI, energy needs, body measurements, heart rate and hydration' },
  { id: 'sports', name: 'Sports', blurb: 'Pace, race times, strength, cycling, swimming, hiking and cricket' },
  { id: 'physics', name: 'Physics', blurb: 'Motion, forces, energy, waves, gravity, heat and electricity' },
  { id: 'chemistry', name: 'Chemistry', blurb: 'Moles, solutions, gas laws, pH and reactions' },
  { id: 'math', name: 'Math', blurb: 'Geometry, triangles, equations, ratios and logarithms' },
  { id: 'statistics', name: 'Statistics', blurb: 'Z-scores, sampling, margins of error, probability and combinations' },
  { id: 'construction', name: 'Construction', blurb: 'Concrete, bricks, tiles, paint, roofs, tanks and timber' },
  { id: 'conversion', name: 'Conversion', blurb: 'Fuel economy, pace and speed, temperature, cooking measures and screens' },
  { id: 'everyday', name: 'Everyday life', blurb: 'Electricity and fuel bills, unit prices, marks and gas cylinders' },
  { id: 'food', name: 'Food', blurb: 'Recipe scaling, cups to grams, calories, pizza, coffee and baking' },
  { id: 'biology', name: 'Biology', blurb: 'Growth, genetics, dilutions, DNA and lab measurements' },
  { id: 'ecology', name: 'Ecology and weather', blurb: 'Carbon footprints, rainwater, dew point, wind chill and heat index' },
  { id: 'electronics', name: 'Electronics', blurb: 'Ohm’s law, dividers, LEDs, RC and LC circuits, 555 timers, op-amps, batteries, bridges, motors, transformers and three-phase power' },
  { id: 'engineering', name: 'Engineering', blurb: 'Beams, columns, stress, fatigue, bearings, springs, joints, screws, brakes, clutches, gears, belts, pumps, turbines and machining' },
  { id: 'heat', name: 'Heat and combustion', blurb: 'Insulation heat loss, pipe expansion loops, LMTD, combustion air, flue-gas loss, fuel use, buoyancy and balloons' },
  { id: 'acoustics', name: 'Sound and acoustics', blurb: 'Adding decibels, distance loss, sound power, reverberation time, wavelength, A-weighting, noise dose and the mass law' },
  { id: 'other', name: 'Other', blurb: 'Downloads, screens, printing, typing, reading and video files' },
] as const;

export type CalcCategory = (typeof CALC_CATEGORIES)[number]['id'];

export interface NumberVar {
  readonly key: string;
  readonly label: string;
  readonly dim: Dimension;
  /** The unit the formulas use. */
  readonly unit: string;
  /** The unit shown at first (default: the formula unit). */
  readonly show?: string;
  /** Example value in the shown unit, filled in when the calculator opens. */
  readonly example?: number;
  /** Zero and negative values are allowed (most quantities are positive). */
  readonly signed?: boolean;
  /** Only ever calculated, never typed in. */
  readonly result?: boolean;
  readonly help?: string;
  /** Upper limits, in the formula unit, with what a value below each means. */
  readonly bands?: readonly (readonly [number, string])[];
}

export interface ChoiceVar {
  readonly key: string;
  readonly label: string;
  readonly choices: readonly { readonly label: string; readonly value: number }[];
  /** Index of the choice selected at first. */
  readonly example?: number;
  readonly help?: string;
}

export type Variable = NumberVar | ChoiceVar;

export const isChoice = (v: Variable): v is ChoiceVar => 'choices' in v;

/** "lhs = rhs" in math.js syntax, optionally only when choice variables have given values. */
export type Equation = string | { readonly when: Readonly<Record<string, number>>; readonly eq: string };

export interface Calculator {
  readonly id: string;
  readonly name: string;
  readonly category: CalcCategory;
  readonly description: string;
  readonly vars: readonly Variable[];
  readonly eqs: readonly Equation[];
  readonly keywords?: readonly string[];
  /** Shown under the results: assumptions, sources, cautions. */
  readonly notes?: string;
}

/** Physical constants usable in formulas. */
export const CONSTANTS: Readonly<Record<string, number>> = {
  /** Standard gravity, m/s². */
  g0: 9.80665,
  /** Gravitational constant, m³/(kg·s²). */
  Gc: 6.6743e-11,
  /** Gas constant, J/(mol·K). */
  Rgas: 8.314462618,
  /** Speed of light, m/s. */
  c0: 299792458,
  /** Planck constant, J·s. */
  hP: 6.62607015e-34,
  NA: 6.02214076e23,
  kB: 1.380649e-23,
};
