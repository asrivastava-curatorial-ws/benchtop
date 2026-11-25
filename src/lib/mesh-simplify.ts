/** Mesh simplification by meshoptimizer (quadric error edge collapse, compiled to WebAssembly and bundled). */
import { type Mesh, tidy } from './mesh';

export interface SimplifyOptions {
  /** Triangles to keep, as a share of what is there (0 to 1). */
  readonly keep: number;
  /** How far the surface may move, as a share of the model's size (1 = no limit). */
  readonly maxError: number;
  /** Leave open edges where they are. */
  readonly lockBorder: boolean;
}

export async function simplifyMesh(mesh: Mesh, options: SimplifyOptions): Promise<{ mesh: Mesh; error: number }> {
  const { MeshoptSimplifier } = await import('meshoptimizer/simplifier');
  await MeshoptSimplifier.ready;
  const faces = mesh.indices.length / 3;
  const target = Math.max(4, Math.floor(faces * Math.min(1, Math.max(0, options.keep)))) * 3;
  const [indices, error] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, options.maxError, options.lockBorder ? ['LockBorder'] : []);
  return { mesh: tidy({ positions: mesh.positions, indices: Uint32Array.from(indices) }), error };
}
