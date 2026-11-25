/**
 * The 3D Model Toolbox's view of a mesh: turn and zoom, open and non-manifold
 * edges drawn in, inside-out faces in red, overhangs tinted, a printer's build
 * volume, and points picked on the surface for measuring.  The model's z axis
 * points up, as on a printer.
 */
import { type Mesh, soupOf, type Vec3 } from '../lib/mesh';

export interface MeshOverlay {
  readonly open?: Float32Array;
  readonly nonManifold?: Float32Array;
  /** One flag per triangle. */
  readonly overhanging?: Uint8Array | null;
}

export interface MeshView {
  /** Shows a mesh; the camera is kept when `keepCamera` is set. */
  readonly show: (mesh: Mesh, overlay: MeshOverlay, keepCamera?: boolean) => void;
  readonly setBed: (size: Vec3 | null) => void;
  /** With a handler, a click on the model reports the point under the cursor. */
  readonly setPicking: (handler: ((point: Vec3) => void) | null) => void;
  readonly setMarkers: (points: readonly Vec3[]) => void;
  readonly snapshot: () => string;
  readonly dispose: () => void;
}

export async function mountMeshView(host: HTMLElement, height: number): Promise<MeshView> {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const width = host.clientWidth || 800;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  const world = new THREE.Scene();
  world.background = new THREE.Color(document.documentElement.dataset.theme === 'dark' ? 0x161b22 : 0xf4f6f8);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
  world.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, 2, 3);
  world.add(sun);
  // Everything about the model lives in a group turned so that its z points up on screen.
  const stand = new THREE.Group();
  stand.rotation.x = -Math.PI / 2;
  world.add(stand);
  const controls = new OrbitControls(camera, renderer.domElement);
  host.replaceChildren(renderer.domElement);
  let queued = 0;
  const render = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      renderer.render(world, camera);
    });
  };
  controls.addEventListener('change', render);

  type Line = InstanceType<typeof THREE.LineSegments>;
  let front: InstanceType<typeof THREE.Mesh> | null = null;
  let parts: InstanceType<typeof THREE.Object3D>[] = [];
  let bed: InstanceType<typeof THREE.Object3D> | null = null;
  let markers: InstanceType<typeof THREE.Object3D>[] = [];
  let bedSize: Vec3 | null = null;
  let extent = 1;
  let picking: ((point: Vec3) => void) | null = null;

  const drop = (items: InstanceType<typeof THREE.Object3D>[]) => {
    for (const item of items) {
      item.parent?.remove(item);
      const held = item as unknown as { geometry?: { dispose: () => void }; material?: { dispose: () => void } };
      held.geometry?.dispose();
      held.material?.dispose();
    }
  };

  const drawBed = () => {
    if (bed) drop([bed]);
    bed = null;
    if (!bedSize || !front) return;
    const box = new THREE.Box3().setFromObject(front);
    const [bx, by, bz] = bedSize;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    // World axes: the model's y runs along -z, its z along y.
    const volume = new THREE.Box3(new THREE.Vector3(cx - bx / 2, box.min.y, cz - by / 2), new THREE.Vector3(cx + bx / 2, box.min.y + bz, cz + by / 2));
    bed = new THREE.Box3Helper(volume, 0x8a8f98);
    world.add(bed);
  };

  const line = (segments: Float32Array, colour: number): Line => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));
    const made = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
    made.renderOrder = 2;
    return made;
  };

  const down = { x: 0, y: 0 };
  const onDown = (event: PointerEvent) => {
    down.x = event.clientX;
    down.y = event.clientY;
  };
  const onUp = (event: PointerEvent) => {
    if (!picking || !front || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObject(front, false)[0];
    if (!hit) return;
    const local = stand.worldToLocal(hit.point.clone());
    picking([local.x, local.y, local.z]);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  const observer = new ResizeObserver(() => {
    const next = host.clientWidth;
    if (!next) return;
    renderer.setSize(next, height);
    camera.aspect = next / height;
    camera.updateProjectionMatrix();
    render();
  });
  observer.observe(host);

  return {
    show: (mesh, overlay, keepCamera = false) => {
      drop(parts);
      parts = [];
      const soup = soupOf(mesh);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(soup, 3));
      const colours = new Float32Array(soup.length);
      const faces = soup.length / 9;
      for (let face = 0; face < faces; face++) {
        const hangs = overlay.overhanging?.[face] === 1;
        for (let k = 0; k < 3; k++) colours.set(hangs ? [0.95, 0.62, 0.2] : [0.33, 0.79, 0.63], face * 9 + k * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      geometry.computeVertexNormals();
      front = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.7, side: THREE.FrontSide }));
      // The inside of a face shows red: a red patch on the outside is a flipped triangle or a hole.
      const back = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xc8443a, side: THREE.BackSide }));
      stand.add(front, back);
      parts.push(front, back);
      if (overlay.open?.length) parts.push(line(overlay.open, 0xff2d2d));
      if (overlay.nonManifold?.length) parts.push(line(overlay.nonManifold, 0xd72bd7));
      for (const part of parts.slice(2)) stand.add(part);
      const box = new THREE.Box3().setFromObject(front);
      extent = box.getSize(new THREE.Vector3()).length() || 1;
      if (!keepCamera) {
        const centre = box.getCenter(new THREE.Vector3());
        camera.position.copy(centre).add(new THREE.Vector3(extent * 0.7, extent * 0.55, extent * 0.9));
        camera.near = extent / 1000;
        camera.far = extent * 100;
        camera.updateProjectionMatrix();
        controls.target.copy(centre);
        controls.update();
      }
      drawBed();
      render();
    },
    setBed: (size) => {
      bedSize = size;
      drawBed();
      render();
    },
    setPicking: (handler) => {
      picking = handler;
      renderer.domElement.style.cursor = handler ? 'crosshair' : '';
    },
    setMarkers: (points) => {
      drop(markers);
      markers = [];
      for (const [x, y, z] of points) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(extent / 150, 12, 8), new THREE.MeshBasicMaterial({ color: 0x1f6fd0, depthTest: false }));
        dot.position.set(x, y, z);
        dot.renderOrder = 3;
        markers.push(dot);
      }
      for (let i = 0; i + 1 < points.length; i += 2) {
        const a = points[i] as Vec3;
        const b = points[i + 1] as Vec3;
        markers.push(line(Float32Array.from([...a, ...b]), 0x1f6fd0));
      }
      for (const marker of markers) stand.add(marker);
      render();
    },
    snapshot: () => {
      renderer.render(world, camera);
      return renderer.domElement.toDataURL('image/png');
    },
    dispose: () => {
      observer.disconnect();
      cancelAnimationFrame(queued);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      drop([...parts, ...markers, ...(bed ? [bed] : [])]);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
