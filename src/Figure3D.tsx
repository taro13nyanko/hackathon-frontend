import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Figure, FigurePart } from "./api";

// Figure3D は、Gemini が返した部品の設計図（Figure）を three.js でデフォルメ模型に組み立てて表示する。
// 組み立て方は 試作/figure3d_prototype_v2.html と同じ（トゥーン調・輪郭線・顔・ゆらゆら）。
export default function Figure3D({ figure }: { figure: Figure }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    addLights(scene);
    const spin = new THREE.Group();
    const model = build(figure);
    const camera = makeCamera(model, 1);
    spin.add(model);
    scene.add(spin, shadow(model));

    // ドラッグで回す（左右＝模型を回す、上下＝見下ろす角度を変える）。離して2.5秒たつと、また正面でゆらゆら
    const elev0 = camera.userData.elev as number;
    let elev = elev0;
    let down = false, lx = 0, ly = 0, auto = true, timer = 0;
    const onDown = (e: PointerEvent) => { down = true; lx = e.clientX; ly = e.clientY; auto = false; canvas.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      spin.rotation.y += (e.clientX - lx) * 0.012;
      elev = clampElev(elev + (e.clientY - ly) * 0.01);
      lx = e.clientX;
      ly = e.clientY;
    };
    const onUp = () => { down = false; clearTimeout(timer); timer = window.setTimeout(() => (auto = true), 2500); };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    const y0 = model.position.y;
    let raf = 0, t0 = performance.now();
    const loop = (t: number) => {
      const dt = (t - t0) / 1000;
      t0 = t;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if (auto) {
        spin.rotation.y += (Math.sin(t / 1700) * 0.5 - spin.rotation.y) * Math.min(1, dt * 2);
        elev += (elev0 - elev) * Math.min(1, dt * 2);
      }
      orbit(camera, elev);
      model.position.y = y0 + Math.abs(Math.sin(t / 420)) * 0.06;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      disposeScene(scene);
      renderer.dispose();
    };
  }, [figure]);

  return <canvas ref={ref} className="figure3d" aria-label={`${figure.name}の3D模型`} />;
}

// renderSnapshot は設計図を画面に出さずに描き、正面と斜め45°の2枚を横に並べた JPEG（data URL）を返す。
// AI に「前回の模型」を見せて直させる（仕上げ）ために使う。
export function renderSnapshot(figure: Figure, size = 448): string {
  const canvas = document.createElement("canvas");
  canvas.width = size * 2;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0xfff8ef, 1);
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  addLights(scene);
  const spin = new THREE.Group();
  const model = build(figure);
  spin.add(model);
  scene.add(spin, shadow(model));
  const camera = makeCamera(model, 1);
  [0, -Math.PI / 4].forEach((angle, i) => {
    spin.rotation.y = angle;
    renderer.setViewport(i * size, 0, size, size);
    renderer.setScissor(i * size, 0, size, size);
    renderer.render(scene, camera);
  });
  const url = canvas.toDataURL("image/jpeg", 0.9);
  disposeScene(scene);
  renderer.dispose();
  return url;
}

// disposeScene は場面の形・材質・貼った絵を片付ける（GPU のメモリを返す）。
export function disposeScene(scene: THREE.Object3D) {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
      o.geometry.dispose();
      const mats = (Array.isArray(o.material) ? o.material : [o.material]) as (THREE.Material & { map?: THREE.Texture | null })[];
      for (const m of mats) {
        m.map?.dispose();
        m.dispose();
      }
    }
  });
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8d6bf, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffe2c4, 0.5);
  rim.position.set(4, 2, -3);
  scene.add(rim);
}

// makeCamera は模型の大きさに合わせてカメラを置く（全体が画面に収まる距離。平たい物＝料理などは上から見下ろす）。
function makeCamera(model: THREE.Object3D, aspect: number) {
  const size = (model.userData.size as THREE.Vector3) ?? new THREE.Vector3(2.2, 2.2, 2.2);
  const fov = 32;
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  const wide = Math.max(size.x, size.z);
  const flat = size.y < wide * 0.6;
  const elev = ((flat ? 36 : 16) * Math.PI) / 180;
  const radius = size.length() / 2;
  const dist = (radius / Math.sin(((fov / 2) * Math.PI) / 180)) * 0.98;
  const cy = size.y * 0.45;
  camera.userData = { elev, dist, cy };
  orbit(camera, elev);
  return camera;
}

// 見下ろす角度の範囲（下からのぞく〜真上の手前まで）
const ELEV_MIN = (-25 * Math.PI) / 180;
const ELEV_MAX = (80 * Math.PI) / 180;
const clampElev = (e: number) => Math.max(ELEV_MIN, Math.min(ELEV_MAX, e));

// orbit はカメラを、同じ距離のまま見下ろす角度 elev（ラジアン）の位置に置き直す。
function orbit(camera: THREE.PerspectiveCamera, elev: number) {
  const { dist, cy } = camera.userData as { dist: number; cy: number };
  camera.position.set(0, cy + dist * Math.sin(elev), dist * Math.cos(elev));
  camera.lookAt(0, cy, 0);
}

// ===== 組み立て =====
const OUTLINE = 0.022; // 輪郭線の太さ（部品の大きさに関係なく同じ）

const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([95, 150, 205, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const mat = (color: string, glow?: boolean) =>
  new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp,
    emissive: glow ? new THREE.Color(color).multiplyScalar(0.6) : new THREE.Color(0x000000),
  });
const outlineMat = () => new THREE.MeshBasicMaterial({ color: 0x3a2f28, side: THREE.BackSide });

function roundedBox(w: number, h: number, d: number, r: number) {
  r = Math.max(0.004, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
  s.moveTo(x, y - r); s.lineTo(x + ww, y - r); s.quadraticCurveTo(x + ww + r, y - r, x + ww + r, y);
  s.lineTo(x + ww + r, y + hh); s.quadraticCurveTo(x + ww + r, y + hh + r, x + ww, y + hh + r);
  s.lineTo(x, y + hh + r); s.quadraticCurveTo(x - r, y + hh + r, x - r, y + hh);
  s.lineTo(x - r, y); s.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(d - 2 * r, 0.001), bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 5, curveSegments: 8,
  });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.computeVertexNormals();
  return g;
}

function geometry(p: FigurePart): THREE.BufferGeometry {
  const s = p.size;
  switch (p.shape) {
    case "box": return roundedBox(s[0], s[1], s[2], Math.min(s[0], s[1], s[2]) * (p.round ?? 0.28));
    case "cylinder":
    case "cone": return new THREE.CylinderGeometry(s[0], s[1], s[2], 32);
    case "sphere": return new THREE.SphereGeometry(s[0], 28, 18);
    case "dome": return new THREE.SphereGeometry(s[0], 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    case "capsule": return new THREE.CapsuleGeometry(s[0], s[1], 8, 24);
    case "torus": return new THREE.TorusGeometry(s[0], s[1], 14, 48, ((p.arc ?? 360) * Math.PI) / 180);
  }
  return new THREE.BoxGeometry(0.3, 0.3, 0.3);
}

// 文字の札（canvas に描いて貼る）
function labelMesh(p: FigurePart) {
  // 細長すぎる札は巨大な絵になってブラウザが固まるので、幅と高さ÷幅をここでも直す（backend と同じ決まり）
  const w = Math.min(4, Math.max(0.1, p.size[0] || 0.1));
  const h = Math.min(w, Math.max(w * 0.1, p.size[1] || w * 0.25));
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = Math.min(512, Math.max(16, Math.round((512 * h) / w)));
  const x = c.getContext("2d");
  if (!x) return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: p.bg || "#ffffff" }));
  if (p.bg) {
    x.fillStyle = p.bg;
    const r = c.height * 0.3;
    x.beginPath(); x.moveTo(r, 0);
    x.arcTo(c.width, 0, c.width, c.height, r); x.arcTo(c.width, c.height, 0, c.height, r);
    x.arcTo(0, c.height, 0, 0, r); x.arcTo(0, 0, c.width, 0, r); x.fill();
  }
  const font = (fs: number) => `800 ${fs}px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif`;
  let fs = c.height * 0.68;
  x.font = font(fs);
  const tw = x.measureText(p.text ?? "").width;
  if (tw > c.width * 0.86) { fs *= (c.width * 0.86) / tw; x.font = font(fs); }
  x.fillStyle = p.ink || "#222";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(p.text ?? "", c.width / 2, c.height / 2 + fs * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
}

export function build(f: Figure) {
  const g = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  let labels = 0;
  for (const p of f.parts.slice(0, 60)) {
    if (p.shape === "label" && ++labels > 6) continue;
    const holder = new THREE.Group();
    let m: THREE.Mesh;
    if (p.shape === "label") {
      m = labelMesh(p);
      holder.add(m);
    } else {
      const geo = geometry(p);
      m = new THREE.Mesh(geo, mat(p.color || "#cccccc", p.glow));
      if (p.outline !== false) {
        geo.computeBoundingBox();
        const sz = geo.boundingBox!.getSize(new THREE.Vector3());
        const sc = p.scale ?? [1, 1, 1];
        const o = new THREE.Mesh(geo, outlineMat());
        o.scale.set(
          1 + (2 * OUTLINE) / Math.max(sz.x * sc[0], 0.02),
          1 + (2 * OUTLINE) / Math.max(sz.y * sc[1], 0.02),
          1 + (2 * OUTLINE) / Math.max(sz.z * sc[2], 0.02),
        );
        holder.add(o);
      }
      holder.add(m);
    }
    holder.position.set(...p.pos);
    if (p.rot) holder.rotation.set(...(p.rot.map((d) => (d * Math.PI) / 180) as [number, number, number]));
    if (p.scale) holder.scale.set(...p.scale);
    g.add(holder);
    meshes.push(m);
  }
  addFace(g, f, meshes);
  // 一番長い辺を 2.4 にそろえ、真ん中を原点に、床（y=0）に立たせる。大きさはカメラ合わせ用に残す
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = 2.4 / Math.max(size.x, size.y, size.z, 0.001);
  g.scale.setScalar(k);
  g.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  g.userData.size = size.clone().multiplyScalar(k);
  return g;
}

// 顔：手前から光線を当てて、部品の表面に貼り付ける
function addFace(group: THREE.Group, f: Figure, meshes: THREE.Mesh[]) {
  const face = f.face;
  if (!face || !meshes[face.part]) return;
  const p = f.parts[face.part], target = meshes[face.part], k = face.scale ?? 1;
  group.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const zAt = (x: number, y: number) => {
    rc.set(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1));
    const h = rc.intersectObject(target, false)[0];
    return h ? h.point.z : p.pos[2] + (p.size[2] ?? p.size[0] ?? 0.3) / 2;
  };
  const x0 = p.pos[0], y = face.y ?? p.pos[1];
  const black = new THREE.MeshBasicMaterial({ color: 0x2b2420 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pink = new THREE.MeshBasicMaterial({ color: 0xff9aa2, transparent: true, opacity: 0.8 });
  const red = new THREE.MeshBasicMaterial({ color: 0xd9534f });
  const put = (m: THREE.Mesh, x: number, yy: number, dz = 0.015) => { m.position.set(x, yy, zAt(x, yy) + dz); group.add(m); };
  const eye = (dx: number, closed: boolean) => {
    const ex = x0 + dx * k, ey = y + 0.06 * k;
    if (closed) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.075 * k, 0.02 * k, 6, 16, Math.PI), black);
      m.rotation.z = Math.PI;
      put(m, ex, ey);
      return;
    }
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.09 * k, 18, 12), black);
    e.scale.set(0.9, 1.1, 0.35);
    put(e, ex, ey);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.03 * k, 8, 6), white), ex + 0.03 * k, ey + 0.04 * k, 0.05);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.014 * k, 8, 6), white), ex - 0.03 * k, ey - 0.035 * k, 0.05);
  };
  const st = face.style;
  eye(-0.24, st === "sleepy");
  eye(0.24, st === "sleepy" || st === "wink");
  for (const dx of [-0.39, 0.39]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.075 * k, 12, 8), pink);
    b.scale.set(1.35, 0.7, 0.25);
    put(b, x0 + dx * k, y - 0.07 * k, 0.012);
  }
  if (st === "open") {
    put(new THREE.Mesh(new THREE.CircleGeometry(0.07 * k, 20, Math.PI, Math.PI), red), x0, y - 0.04 * k, 0.02);
  } else {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.06 * k, 0.018 * k, 6, 16, Math.PI), black);
    m.rotation.z = Math.PI;
    put(m, x0, y - 0.07 * k, 0.02);
  }
}

export function shadow(model: THREE.Object3D) {
  const size = (model.userData.size as THREE.Vector3) ?? new THREE.Vector3(2.2, 2.2, 2.2);
  const r = Math.max(size.x, size.z) * 1.25;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!, gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, "rgba(80,60,40,0.35)");
  gr.addColorStop(1, "rgba(80,60,40,0)");
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(r, r),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  return m;
}
