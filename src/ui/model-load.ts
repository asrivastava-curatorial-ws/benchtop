/** Reads a 3D model file of any kind the viewer knows into loose triangles (nine numbers each). */
import { parseStl } from '../lib/mesh';

export const MESH_EXTENSIONS = ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf', 'amf', 'dae', 'fbx', 'wrl', 'vrml', 'vtk', 'vtp', '3ds'] as const;
export const MESH_ACCEPT = MESH_EXTENSIONS.map((e) => `.${e}`).join(',');

export async function loadTriangles(bytes: ArrayBuffer, name: string): Promise<Float32Array> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'stl') return parseStl(new Uint8Array(bytes));
  const THREE = await import('three');
  const text = () => new TextDecoder().decode(bytes);
  type Object3D = InstanceType<typeof THREE.Object3D>;
  let object: Object3D;
  // Formats that have y pointing up are turned to stand on z, as printers and CAD have it.
  let yUp = false;
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    object = new OBJLoader().parse(text());
  } else if (ext === 'ply') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    object = new THREE.Mesh(new PLYLoader().parse(bytes));
  } else if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    object = (await new GLTFLoader().parseAsync(ext === 'glb' ? bytes : text(), '')).scene;
    yUp = true;
  } else if (ext === '3mf') {
    const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
    object = new ThreeMFLoader().parse(bytes);
  } else if (ext === 'amf') {
    const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
    object = new AMFLoader().parse(bytes);
  } else if (ext === 'dae') {
    const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
    const collada = new ColladaLoader().parse(text(), '');
    if (!collada) throw new Error('The Collada file could not be read.');
    object = collada.scene;
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    object = new FBXLoader().parse(bytes, '');
    yUp = true;
  } else if (ext === 'wrl' || ext === 'vrml') {
    const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
    object = new VRMLLoader().parse(text(), '');
    yUp = true;
  } else if (ext === 'vtk' || ext === 'vtp') {
    const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js');
    object = new THREE.Mesh(new VTKLoader().parse(bytes, ''));
  } else if (ext === '3ds') {
    const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
    object = new TDSLoader().parse(bytes, '');
  } else throw new Error('Open an STL, OBJ, PLY, glTF, GLB, 3MF, AMF, DAE, FBX, VRML, VTK or 3DS model.');

  object.updateMatrixWorld(true);
  const out: number[] = [];
  const point = new THREE.Vector3();
  object.traverse((child) => {
    const mesh = child as InstanceType<typeof THREE.Mesh>;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        point.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
        if (yUp) out.push(point.x, -point.z, point.y);
        else out.push(point.x, point.y, point.z);
      }
    }
  });
  if (!out.length) throw new Error('This file has no triangles: it may hold only points or lines.');
  return Float32Array.from(out);
}
