import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Figure } from "./api";
import { addLights, build, disposeScene, shadow } from "./Figure3D";

// 箱庭：自分が売った物・買った物の模型を、1つの丸い庭に並べて見せる。
// ドラッグで庭を回す。模型をタップするとその商品を開く。
export type GardenEntry = { id: string; title: string; figure: Figure; tag: "sold" | "selling" | "bought" };

const TAG_TEXT = { sold: "売った", selling: "出品中", bought: "買った" } as const;
const TAG_COLOR = { sold: "#e8833a", selling: "#8a8f98", bought: "#3a8fe8" } as const;

const FIG_SCALE = 0.5; // 模型は一番長い辺が 2.4 にそろえてあるので、庭では 1.2 にする
const GAP = 1.75; // 模型どうしの間隔

export default function Garden3D({ entries, onOpen }: { entries: GardenEntry[]; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || entries.length === 0) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    addLights(scene);
    const garden = new THREE.Group(); // ドラッグでこれを回す
    scene.add(garden);

    // 並べ方：ほぼ正方形のマス目に、真ん中寄せで
    const n = entries.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const slots = entries.map((_, i) => {
      const r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? n - r * cols : cols; // 最後の行は数が少ないので真ん中に寄せる
      const c = i % cols;
      return new THREE.Vector2((c - (inRow - 1) / 2) * GAP, (r - (rows - 1) / 2) * GAP);
    });
    const reach = Math.max(...slots.map((p) => p.length())) + GAP * 0.9;

    garden.add(ground(reach), ...decorations(reach, slots));

    // 模型を置く。タップ判定用に、各模型の中のメッシュに商品 ID を覚えさせる
    const pickables: THREE.Object3D[] = [];
    const bobs: { obj: THREE.Object3D; y0: number; phase: number }[] = [];
    entries.forEach((e, i) => {
      const holder = new THREE.Group();
      const model = build(e.figure);
      holder.add(model, shadow(model));
      holder.scale.setScalar(FIG_SCALE);
      holder.position.set(slots[i].x, 0.06, slots[i].y);
      holder.rotation.y = (i % 2 ? -1 : 1) * 0.25; // 少しずつ向きを変えて、並べた感じを減らす
      holder.traverse((o) => (o.userData.itemId = e.id));
      pickables.push(holder);
      bobs.push({ obj: model, y0: model.position.y, phase: i * 0.9 });
      const tag = nameTag(e.title, e.tag);
      const height = ((model.userData.size as THREE.Vector3 | undefined)?.y ?? 2.4) * FIG_SCALE;
      tag.position.set(slots[i].x, height + 0.22, slots[i].y); // 模型の頭の上（回しても隠れない）
      tag.userData.itemId = e.id;
      pickables.push(tag);
      garden.add(holder, tag);
    });

    // カメラ：庭全体が収まるよう、斜め上から
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    // 見下ろす角度 elev は上下のドラッグで変わる（真横に近い 8° 〜 ほぼ真上の 85°）
    const ELEV_MIN = (8 * Math.PI) / 180, ELEV_MAX = (85 * Math.PI) / 180;
    let elev = (38 * Math.PI) / 180;
    let fit = 10;
    const placeCamera = () => {
      camera.position.set(0, fit * Math.sin(elev) + 0.6, fit * Math.cos(elev));
      camera.lookAt(0, 0.4, 0);
    };
    const fitTo = (aspect: number) => {
      fit = (reach * 1.05) / Math.tan(((34 / 2) * Math.PI) / 180) / Math.min(1, aspect);
    };

    // ドラッグで回す／ほとんど動かさずに離したらタップ（その模型の商品を開く）
    let down = false, lx = 0, ly = 0, moved = 0, sx = 0, sy = 0, vel = 0;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => {
      down = true; lx = sx = e.clientX; ly = sy = e.clientY; moved = 0; vel = 0;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      garden.rotation.y += dx * 0.008;
      vel = dx * 0.008;
      elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX, elev + dy * 0.006));
      placeCamera();
      moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (moved > 6) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, true).find((h) => h.object.userData.itemId);
      if (hit) openRef.current(hit.object.userData.itemId as string);
    };
    const onCancel = () => (down = false);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);

    let raf = 0, t0 = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - t0) / 1000);
      t0 = t;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        fitTo(camera.aspect);
        placeCamera();
        camera.updateProjectionMatrix();
      }
      if (!down) {
        vel *= Math.pow(0.04, dt); // 手を離したあと少し惰性で回る
        garden.rotation.y += vel + dt * 0.05; // ゆっくり自転
      }
      for (const b of bobs) b.obj.position.y = b.y0 + Math.abs(Math.sin(t / 520 + b.phase)) * 0.08;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      disposeScene(scene);
      renderer.dispose();
    };
  }, [entries]);

  return <canvas ref={ref} className="garden3d" aria-label={`箱庭（模型 ${entries.length} 個）`} />;
}

const toon = (color: string) => new THREE.MeshToonMaterial({ color });

// 丸い芝生の島（ふちは土）
function ground(r: number) {
  const g = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.08, r * 0.92, 0.5, 64), toon("#b8875a"));
  soil.position.y = -0.25;
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 64), toon("#9fd67a"));
  grass.position.y = 0.0;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 64), toon("#7cbf57"));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  g.add(soil, grass, rim);
  return g;
}

// 庭のふちに、小さな木と花を置く（模型のマスの上には置かない）
function decorations(r: number, slots: THREE.Vector2[]) {
  const out: THREE.Object3D[] = [];
  const count = Math.max(6, Math.round(r * 4));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.3;
    const d = r - 0.35 - (i % 3) * 0.12;
    const p = new THREE.Vector2(Math.cos(a) * d, Math.sin(a) * d);
    if (slots.some((s) => s.distanceTo(p) < 0.9)) continue;
    out.push(i % 3 === 0 ? tree() : flower(i));
    out[out.length - 1].position.set(p.x, 0.05, p.y);
  }
  return out;
}

function tree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 10), toon("#8a5a3b"));
  trunk.position.y = 0.15;
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), toon("#5fb35a"));
  leaves.position.y = 0.42;
  leaves.scale.set(1, 1.15, 1);
  g.add(trunk, leaves);
  return g;
}

function flower(i: number) {
  const colors = ["#ff9aa2", "#ffd36e", "#ffffff", "#c9a7ff"];
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), toon("#4f9a45"));
  stem.position.y = 0.07;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(colors[i % colors.length]));
  head.position.y = 0.15;
  g.add(stem, head);
  return g;
}

// 模型の手前に立てる名札（商品名＋売った/買った）
function nameTag(title: string, tag: GardenEntry["tag"]) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const x = c.getContext("2d")!;
  const short = [...title].length > 12 ? [...title].slice(0, 11).join("") + "…" : title;
  x.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(x, 4, 24, 504, 96, 40);
  x.fill();
  x.fillStyle = TAG_COLOR[tag];
  roundRect(x, 16, 36, 112, 72, 30);
  x.fill();
  x.font = `800 36px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = "#fff";
  x.fillText(TAG_TEXT[tag], 72, 74);
  x.fillStyle = "#3a2f28";
  x.textAlign = "left";
  let fs = 38;
  x.font = `700 ${fs}px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif`;
  const w = x.measureText(short).width;
  if (w > 350) {
    fs *= 350 / w;
    x.font = `700 ${fs}px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif`;
  }
  x.fillText(short, 144, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.25, 0.3125, 1);
  s.center.set(0.5, 0);
  return s;
}

function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}
