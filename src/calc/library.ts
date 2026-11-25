/** Every calculator in the library. */
import { ACOUSTICS } from './library/acoustics';
import { BIOLOGY } from './library/biology';
import { CHEMISTRY } from './library/chemistry';
import { CONSTRUCTION } from './library/construction';
import { CONVERSION } from './library/conversion';
import { ECOLOGY } from './library/ecology';
import { ELECTRONICS } from './library/electronics';
import { ENGINEERING } from './library/engineering';
import { EVERYDAY } from './library/everyday';
import { FINANCE } from './library/finance';
import { FOOD } from './library/food';
import { HEALTH } from './library/health';
import { HEAT } from './library/heat';
import { MACHINES } from './library/machines';
import { MATH } from './library/math';
import { OTHER } from './library/other';
import { PHYSICS } from './library/physics';
import { POPULAR } from './library/popular';
import { SPORTS } from './library/sports';
import { STATISTICS } from './library/statistics';
import type { CalcCategory, Calculator } from './types';

export const CALCULATORS: readonly Calculator[] = [
  ...FINANCE,
  ...HEALTH,
  ...SPORTS,
  ...PHYSICS,
  ...CHEMISTRY,
  ...MATH,
  ...STATISTICS,
  ...CONSTRUCTION,
  ...CONVERSION,
  ...EVERYDAY,
  ...FOOD,
  ...BIOLOGY,
  ...ECOLOGY,
  ...ELECTRONICS,
  ...ENGINEERING,
  ...MACHINES,
  ...HEAT,
  ...ACOUSTICS,
  ...OTHER,
  ...POPULAR,
];

export const findCalculator = (id: string): Calculator | undefined => CALCULATORS.find((c) => c.id === id);

export const calculatorsIn = (category: CalcCategory): Calculator[] => CALCULATORS.filter((c) => c.category === category);
