/**
 * A turnable 3D view of a model file (three.js, MIT), shared by the 3D Model
 * Viewer and notes.  Meshes: STL, OBJ, PLY, glTF/GLB, 3MF, AMF, Collada (DAE),
 * FBX, VRML, VTK, 3DS.  Point clouds: PCD, XYZ.  Toolpaths: G-code.
 */
import { parseGcode } from '../lib/gcode';

export const MODEL_EXTENSIONS = ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf', 'amf', 'dae', 'fbx', 'wrl', 'vrml', 'vtk', 'vtp', '3ds', 'pcd', 'xyz', 'gcode', 'gco', 'nc', 'ngc', 'tap'] as const;
export const MODEL_ACCEPT = MODEL_EXTENSIONS.map((e) => `.${e}`).join(',');

export const isModelName = (name: string) => (MODEL_EXTENSIONS as readonly string[]).includes(name.split('.').pop()?.toLowerCase() ?? '');

export interface ModelScene {
  readonly info: string;
  readonly dispose: () => void;
  readonly setTravel: (on: boolean) => void;
  /** The current view as a PNG data URL. */
  readonly snapshot: () => string;
}

/** Draws the model into `host`, sized to its width.  Throws for formats it cannot read. */
export async function mountModel(host: HTMLElement, bytes: ArrayBuffer, name: string, options: { height?: number; showTravel?: boolean } = {}): Promise<ModelScene> {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const width = host.clientWidth || 800;
  const height = options.height ?? Math.max(360, Math.round(width * 0.6));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  const world = new THREE.Scene();
  world.background = new THREE.Color(document.documentElement.dataset.theme === 'dark' ? 0x161b22 : 0xf4f6f8);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
  world.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(1, 2, 3);
  world.add(sun);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const text = () => new TextDecoder().decode(bytes);
  let object: InstanceType<typeof THREE.Object3D>;
  let travel: InstanceType<typeof THREE.LineSegments> | null = null;
  let info = '';
  const material = new THREE.MeshStandardMaterial({ color: 0x53c9a0, metalness: 0.1, roughness: 0.6 });
  // biome-ignore lint/suspicious/noExplicitAny: three's loaders return differently typed geometries
  const meshOrPoints = (geometry: any) => {
    if (geometry.index || geometry.attributes.normal || (geometry.attributes.position?.count ?? 0) % 3 === 0) {
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, geometry.attributes.color ? new THREE.MeshStandardMaterial({ vertexColors: true }) : material);
    }
    return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: Boolean(geometry.attributes.color) }));
  };
  if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const geometry = new STLLoader().parse(bytes);
    geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry, material);
    info = `${(geometry.attributes.position?.count ?? 0) / 3} triangles`;
  } else if (ext === 'ply') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const geometry = new PLYLoader().parse(bytes);
    object =
      geometry.index || geometry.attributes.normal ? meshOrPoints(geometry) : new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: Boolean(geometry.attributes.color) }));
    info = `${geometry.attributes.position?.count ?? 0} points`;
  } else if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    object = new OBJLoader().parse(text());
    object.traverse((child) => {
      if ((child as InstanceType<typeof THREE.Mesh>).isMesh) (child as InstanceType<typeof THREE.Mesh>).material = material;
    });
    info = 'OBJ model';
  } else if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(ext === 'glb' ? bytes : text(), '');
    object = gltf.scene;
    info = `glTF: ${gltf.scenes.length} scene(s), ${gltf.animations.length} animation(s)`;
  } else if (ext === '3mf') {
    const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
    object = new ThreeMFLoader().parse(bytes);
    object.rotation.x = -Math.PI / 2;
    info = '3MF model';
  } else if (ext === 'amf') {
    const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
    object = new AMFLoader().parse(bytes);
    info = 'AMF model';
  } else if (ext === 'dae') {
    const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
    const collada = new ColladaLoader().parse(text(), '');
    if (!collada) throw new Error('The Collada file could not be read.');
    object = collada.scene;
    info = 'Collada model';
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    object = new FBXLoader().parse(bytes, '');
    info = `FBX model${object.animations.length ? `, ${object.animations.length} animation(s)` : ''}`;
  } else if (ext === 'wrl' || ext === 'vrml') {
    const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
    object = new VRMLLoader().parse(text(), '');
    info = 'VRML model';
  } else if (ext === 'vtk' || ext === 'vtp') {
    const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js');
    object = meshOrPoints(new VTKLoader().parse(bytes, ''));
    info = 'VTK model';
  } else if (ext === '3ds') {
    const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
    object = new TDSLoader().parse(bytes, '');
    info = '3DS model';
  } else if (ext === 'pcd') {
    const { PCDLoader } = await import('three/examples/jsm/loaders/PCDLoader.js');
    object = new PCDLoader().parse(bytes);
    info = 'Point cloud';
  } else if (ext === 'xyz') {
    const { XYZLoader } = await import('three/examples/jsm/loaders/XYZLoader.js');
    const loader = new XYZLoader();
    const geometry = await new Promise<InstanceType<typeof THREE.BufferGeometry>>((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([bytes]));
      loader.load(
        url,
        (g) => {
          URL.revokeObjectURL(url);
          resolve(g);
        },
        undefined,
        (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        },
      );
    });
    object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: Boolean(geometry.attributes.color) }));
    info = `${geometry.attributes.position?.count ?? 0} points`;
  } else if (['gcode', 'gco', 'nc', 'ngc', 'tap', 'g'].includes(ext)) {
    const path = parseGcode(text());
    const group = new THREE.Group();
    const cuts = new THREE.BufferGeometry();
    cuts.setAttribute('position', new THREE.BufferAttribute(path.segments, 3));
    const colours = new Float32Array(path.segments.length);
    const [, , z0, , , z1] = path.box;
    for (let i = 0; i < path.segments.length; i += 3) {
      const t = z1 > z0 ? ((path.segments[i + 2] as number) - z0) / (z1 - z0) : 0;
      const c = new THREE.Color().setHSL(0.6 - t * 0.6, 0.75, 0.5);
      colours.set([c.r, c.g, c.b], i);
    }
    cuts.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    group.add(new THREE.LineSegments(cuts, new THREE.LineBasicMaterial({ vertexColors: true })));
    const moves = new THREE.BufferGeometry();
    moves.setAttribute('position', new THREE.BufferAttribute(path.travel, 3));
    travel = new THREE.LineSegments(moves, new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.35 }));
    travel.visible = options.showTravel === true;
    group.add(travel);
    group.rotation.x = -Math.PI / 2;
    object = group;
    const [x0, y0, , x1, y1] = path.box;
    info = `${path.layers} layers, ${(path.length / 1000).toFixed(2)} m of moves, ${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)} × ${(z1 - z0).toFixed(1)} mm`;
  } else {
    renderer.dispose();
    throw new Error('Open an STL, OBJ, PLY, glTF, GLB, 3MF, AMF, DAE, FBX, VRML, VTK, 3DS, PCD, XYZ or G-code file.');
  }
  host.replaceChildren(renderer.domElement);
  world.add(object);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3()).length() || 1;
  const centre = bounds.getCenter(new THREE.Vector3());
  camera.position.copy(centre).add(new THREE.Vector3(size * 0.6, size * 0.5, size * 0.8));
  camera.near = size / 1000;
  camera.far = size * 100;
  camera.updateProjectionMatrix();
  const grid = new THREE.GridHelper(size * 1.5, 20, 0x888888, 0x444444);
  grid.position.y = bounds.min.y;
  world.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.update();
  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    controls.update();
    renderer.render(world, camera);
  };
  tick();
  return {
    info,
    dispose: () => {
      cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
    setTravel: (on) => {
      if (travel) travel.visible = on;
    },
    snapshot: () => {
      renderer.render(world, camera);
      return renderer.domElement.toDataURL('image/png');
    },
  };
}
