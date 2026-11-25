/** Boolean operations on shapes (union, difference, intersection, exclusion), done by Paper.js on the curves themselves. */
import { parsePathData, pathData, type Shape, type SubPath } from './vector';

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude';

export const BOOLEAN_LABELS: Readonly<Record<BooleanOp, string>> = {
  unite: 'Union',
  subtract: 'Difference',
  intersect: 'Intersection',
  exclude: 'Exclusion',
};

/** `lower` combined with `upper`; for a difference, `upper` is cut out of `lower`. */
export async function booleanPaths(lower: Pick<Shape, 'paths' | 'evenOdd'>, upper: Pick<Shape, 'paths' | 'evenOdd'>, op: BooleanOp): Promise<SubPath[]> {
  const loaded = await import('paper/dist/paper-core');
  const paper = 'default' in loaded ? (loaded.default as typeof loaded) : loaded;
  const scope = new paper.PaperScope();
  scope.setup(new paper.Size(1, 1));
  scope.activate();
  try {
    const item = (shape: Pick<Shape, 'paths' | 'evenOdd'>) => {
      // Boolean operations work on areas, so open paths are closed first.
      const made = new paper.CompoundPath(
        pathData(
          shape.paths.map((path) => ({ ...path, closed: true })),
          4,
        ),
      );
      made.fillRule = shape.evenOdd ? 'evenodd' : 'nonzero';
      return made;
    };
    const a = item(lower);
    const b = item(upper);
    const result = a[op](b, { insert: false });
    return parsePathData(result.pathData).filter((path) => path.nodes.length > 1);
  } finally {
    scope.project.remove();
  }
}
