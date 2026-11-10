import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { build, disposeScene, shadow } from "./Figure3D";
import { SKY_COLORS, TAG_COLOR, TAG_TEXT, gardenLevel, type GardenEntry, type TimeOfDay } from "./garden";

// 箱庭：自分が売った物・買った物・出品中の物の模型を、1つの島に並べて見せる。
// - 模型の数で島が育つ（池・ちょうちょ → 小道と柵 → 家と風車 → 虹と旗）
// - 朝・昼・夕方・夜で空と光が変わる（夜は星とランタン）
// - ドラッグで回す（左右）・見下ろす角度（上下）、ホイール／2本指でズーム
// - 模型をタップすると、その模型がはねてカメラが寄り、onSelect で画面に紹介カードを出す
// - 模型をつかんで動かすと、好きな場所に置ける（onMove で画面に知らせ、画面が保存する）
export type GardenHandle = { snapshot: () => string | null };

const FIG_SCALE = 0.5; // 模型は一番長い辺が 2.4 にそろえてあるので、庭では 1.2 にする
const GAP = 1.9; // 模型どうしの間隔
const FONT = `"Hiragino Sans","Noto Sans JP",system-ui,sans-serif`;

type Props = {
  entries: GardenEntry[];
  time: TimeOfDay;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove?: (id: string, x: number, z: number) => void;
  handleRef?: MutableRefObject<GardenHandle | null>;
};

type Fig = { id: string; base: THREE.Group; holder: THREE.Group; model: THREE.Object3D; y0: number; phase: number; jumpT: number; lift: number };
type Decor = { obj: THREE.Object3D; p: THREE.Vector2; r: number };
type Ticker = (t: number, dt: number) => void;

export default function Garden3D({ entries, time, selectedId, onSelect, onMove, handleRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const selectRef = useRef(onSelect);
  const moveRef = useRef(onMove);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectRef.current = onSelect;
    moveRef.current = onMove;
  }, [onSelect, onMove]);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || entries.length === 0) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const garden = new THREE.Group(); // ドラッグでこれを回す
    scene.add(garden);
    const tickers: Ticker[] = [];
    const level = gardenLevel(entries.length);

    // ---- 模型の置き場所：ほぼ正方形のマス目に、真ん中寄せで ----
    const n = entries.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const grid = (i: number) => {
      const r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const c = i % cols;
      return new THREE.Vector2((c - (inRow - 1) / 2) * GAP, (r - (rows - 1) / 2) * GAP);
    };
    // 島の大きさは、マス目の並びとレベルだけで決める（動かした場所に合わせると、描き直すたびに広がってしまう）
    const reach = Math.max(GAP * 0.6, ...entries.map((_, i) => grid(i).length())) + GAP * 0.7;
    const radius = Math.min(14, reach + 0.6 + level.lv * 0.25); // レベルが上がると島が広がる
    const roam = radius - 0.75; // 模型を置ける範囲（島の中心からの距離）
    const MIN_APART = 1.15; // 模型どうしの間をこれだけあける

    // 動かした模型は、その場所（島からはみ出していたら島の中へ）
    const slots: THREE.Vector2[] = new Array(n);
    const placed: THREE.Vector2[] = [];
    entries.forEach((e, i) => {
      if (!e.spot || !Number.isFinite(e.spot.x) || !Number.isFinite(e.spot.z)) return;
      const p = new THREE.Vector2(e.spot.x, e.spot.z);
      if (p.length() > roam) p.setLength(roam);
      slots[i] = p;
      placed.push(p);
    });
    // 動かしていない模型はマス目へ。ふさがっていたら（模型が増えてマス目がずれたときなど）、中心に近い空き場所へ
    const free: THREE.Vector2[] = [];
    const step = GAP * 0.65;
    for (let gx = -12; gx <= 12; gx++)
      for (let gz = -12; gz <= 12; gz++) {
        const p = new THREE.Vector2(gx * step, gz * step);
        if (p.length() <= roam) free.push(p);
      }
    free.sort((a, b) => a.length() - b.length());
    entries.forEach((_, i) => {
      if (slots[i]) return;
      let p = grid(i);
      if (p.length() > roam) p.setLength(roam);
      if (placed.some((q) => q.distanceTo(p) < MIN_APART)) {
        const spare = free.find((c) => placed.every((q) => q.distanceTo(c) >= MIN_APART));
        if (spare) p = spare.clone();
      }
      slots[i] = p;
      placed.push(p);
    });

    // ---- 空・光・島 ----
    addLights(scene, time);
    scene.add(...sky(time, radius, tickers));
    garden.add(ground(radius, time));

    // 飾りは、模型のマスや先に置いた飾りとぶつからない場所に置く（毎回同じ場所になるよう、乱数は使わない）
    const taken = slots.map((p) => ({ p, r: 0.95 }));
    let seed = 0;
    const spot = (r: number, from: number, to: number) => {
      for (let k = 0; k < 400; k++) {
        const a = (seed++ * 2.39996) % (Math.PI * 2); // 黄金角で散らす
        const d = from + ((k * 0.618) % 1) * (to - from);
        const p = new THREE.Vector2(Math.cos(a) * d, Math.sin(a) * d);
        if (taken.every((x) => x.p.distanceTo(p) >= x.r + r)) {
          taken.push({ p, r });
          return p;
        }
      }
      return null;
    };
    const decor: Decor[] = [];
    const place = (obj: THREE.Object3D, p: THREE.Vector2 | null, y = 0.05) => {
      if (!p) return;
      obj.position.set(p.x, y, p.y);
      obj.rotation.y = Math.atan2(p.x, p.y);
      garden.add(obj);
      decor.push({ obj, p, r: taken[taken.length - 1].r });
    };

    if (level.lv >= 2) place(pond(), spot(0.75, radius * 0.45, radius - 0.9), 0.051);
    if (level.lv >= 3) {
      garden.add(fence(radius - 0.14));
      for (let i = 0; i < 10 + level.lv * 3; i++) place(stone(i), spot(0.12, radius - 0.75, radius - 0.4), 0.051);
    }
    if (level.lv >= 4) {
      place(house(), spot(0.55, radius * 0.5, radius - 0.6));
      const mill = windmill(tickers);
      place(mill, spot(0.5, radius * 0.5, radius - 0.6));
    }
    if (level.lv >= 5) {
      garden.add(rainbow(radius));
      place(flag(tickers), spot(0.25, radius * 0.5, radius - 0.5));
    }
    for (let i = 0; i < 3 + level.lv * 2; i++) place(tree(i), spot(0.3, radius * 0.55, radius - 0.35));
    for (let i = 0; i < 6 + level.lv * 4; i++) place(flower(i), spot(0.1, radius * 0.3, radius - 0.25));
    if (time === "night") {
      for (let i = 0; i < 4; i++) place(lantern(i < 3), spot(0.3, radius * 0.4, radius - 0.4));
    }
    if (level.lv >= 2 && time !== "night") {
      for (let i = 0; i < 3; i++) garden.add(butterfly(i, radius, tickers));
    }

    // ---- 模型：色つきの台座の上に立てる。タップ判定用に、中のものすべてに商品 ID を覚えさせる ----
    const figs: Fig[] = [];
    const pickables: THREE.Object3D[] = [];
    entries.forEach((e, i) => {
      const base = new THREE.Group();
      base.position.set(slots[i].x, 0.05, slots[i].y);
      const holder = new THREE.Group();
      const model = build(e.figure);
      holder.add(model, shadow(model));
      holder.scale.setScalar(FIG_SCALE);
      holder.position.y = 0.1;
      holder.rotation.y = (i % 2 ? -1 : 1) * 0.25; // 少しずつ向きを変えて、並べた感じを減らす
      const height = ((model.userData.size as THREE.Vector3 | undefined)?.y ?? 2.4) * FIG_SCALE;
      const tag = nameTag(e.title, e.tag, !!e.isNew);
      tag.position.y = 0.1 + height + 0.22; // 模型の頭の上（回しても隠れない）
      base.add(pedestal(TAG_COLOR[e.tag]), holder, tag);
      if (e.isNew) base.add(sparkles(height, tickers, i));
      base.traverse((o) => (o.userData.itemId = e.id));
      garden.add(base);
      pickables.push(base);
      figs.push({ id: e.id, base, holder, model, y0: model.position.y, phase: i * 0.9, jumpT: -1, lift: 0 });
    });

    // 模型の下に来た飾り（木・花・家など）は隠す
    const updateDecor = () => {
      for (const d of decor) {
        d.obj.visible = figs.every((f) => Math.hypot(f.base.position.x - d.p.x, f.base.position.z - d.p.y) >= d.r + 0.5);
      }
    };
    updateDecor();

    // つかんでいる模型の置き場所に出す輪
    const dropRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.04, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    dropRing.rotation.x = Math.PI / 2;
    dropRing.visible = false;
    garden.add(dropRing);

    // 選んだ模型の足もとに光る輪
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.045, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    garden.add(ring);

    // ---- カメラ ----
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    const ELEV_MIN = (8 * Math.PI) / 180, ELEV_MAX = (85 * Math.PI) / 180;
    let elev = (36 * Math.PI) / 180;
    let fit = 10; // 島全体が収まる距離（画面の縦横比で変わる）
    let userZoom = 1; // ホイール・2本指で変える（0.45〜1.3）
    let zoom = 1; // 実際の倍率（選んだときは寄る）
    const target = new THREE.Vector3(); // カメラが見る点（選んだ模型へ寄っていく）
    const placeCamera = () => {
      const d = fit * zoom;
      camera.position.set(target.x, target.y + d * Math.sin(elev) + 0.6, target.z + d * Math.cos(elev));
      camera.lookAt(target.x, target.y + 0.45, target.z);
    };
    const fitTo = (aspect: number) => {
      fit = ((radius + 0.4) * 1.05) / Math.tan(((34 / 2) * Math.PI) / 180) / Math.min(1, aspect);
    };

    // ---- 操作 ----
    // 1本指：模型の上なら「つかんで動かす」、ほかの場所なら「回す・角度」。ほぼ動かさずに離す＝タップ
    // 2本指・ホイール：ズーム
    const pointers = new Map<number, { x: number; y: number }>();
    let lx = 0, ly = 0, moved = 0, sx = 0, sy = 0, vel = 0, pinch = 0;
    const ray = new THREE.Raycaster();
    // 模型を動かす面：つかんだ点と同じ高さの水平な面（頭をつかんでも、指の下で動く）
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
    let grab: { fig: Fig; offset: THREE.Vector2; dragging: boolean } | null = null;
    const aim = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera);
    };
    const pick = (cx: number, cy: number) => {
      aim(cx, cy);
      const hit = ray.intersectObjects(pickables, true).find((h) => h.object.userData.itemId);
      const fig = hit ? figs.find((f) => f.id === hit.object.userData.itemId) ?? null : null;
      return fig && hit ? { fig, y: hit.point.y } : null;
    };
    // 画面の点の先にある、動かす面の位置（庭は回っているので、庭の中の座標に直す）
    const groundAt = (cx: number, cy: number) => {
      aim(cx, cy);
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(floor, p)) return null;
      garden.worldToLocal(p);
      return new THREE.Vector2(p.x, p.z);
    };
    const drop = () => {
      if (!grab) return;
      const { fig, dragging } = grab;
      grab = null;
      dropRing.visible = false;
      canvas.style.cursor = "";
      if (!dragging) return;
      // ほかの模型と重なったら少し押し戻す。島の外には出さない
      const p = new THREE.Vector2(fig.base.position.x, fig.base.position.z);
      for (let pass = 0; pass < 4; pass++) {
        for (const o of figs) {
          if (o === fig) continue;
          const q = new THREE.Vector2(o.base.position.x, o.base.position.z);
          const d = p.distanceTo(q);
          if (d < MIN_APART) p.copy(q).add((d > 1e-3 ? p.clone().sub(q) : new THREE.Vector2(1, 0)).setLength(MIN_APART));
        }
        if (p.length() > roam) p.setLength(roam);
      }
      fig.base.position.x = p.x;
      fig.base.position.z = p.y;
      fig.jumpT = 0.35; // 着地で小さくはねる
      updateDecor();
      moveRef.current?.(fig.id, Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000);
    };
    const clampZoom = (z: number) => Math.max(0.45, Math.min(1.3, z));
    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 合成イベントなどでは取れないことがある
      }
      if (pointers.size === 1) {
        lx = sx = e.clientX;
        ly = sy = e.clientY;
        moved = 0;
        vel = 0;
        const hit = pick(e.clientX, e.clientY);
        if (hit) floor.constant = -Math.max(0.1, Math.min(2, hit.y));
        const g = hit && groundAt(e.clientX, e.clientY);
        grab = hit && g ? { fig: hit.fig, offset: new THREE.Vector2(hit.fig.base.position.x, hit.fig.base.position.z).sub(g), dragging: false } : null;
      } else if (pointers.size === 2) {
        drop(); // 2本指になったら、つかむのをやめてズーム
        pinch = pinchDist();
        moved = 99; // 2本指はタップにしない
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const d = pinchDist();
        if (pinch > 0 && d > 0) userZoom = clampZoom(userZoom * (pinch / d));
        pinch = d;
        return;
      }
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
      if (grab) {
        if (!grab.dragging && moved <= 6) return;
        if (!grab.dragging && selectedRef.current) selectRef.current(null); // 動かし始めたら紹介カードは閉じる
        grab.dragging = true;
        canvas.style.cursor = "grabbing";
        const g = groundAt(e.clientX, e.clientY);
        if (!g) return;
        const p = g.add(grab.offset);
        if (p.length() > roam) p.setLength(roam);
        grab.fig.base.position.x = p.x;
        grab.fig.base.position.z = p.y;
        dropRing.visible = true;
        dropRing.position.set(p.x, 0.12, p.y);
        updateDecor();
        return;
      }
      garden.rotation.y += dx * 0.008;
      vel = dx * 0.008;
      elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX, elev + dy * 0.006));
    };
    // マウスを模型に乗せたら「つかめる」手の形に
    const onHover = (e: PointerEvent) => {
      if (pointers.size > 0 || e.pointerType !== "mouse") return;
      canvas.style.cursor = pick(e.clientX, e.clientY) ? "grab" : "";
    };
    // 2本指のあと1本指に戻ったら、残った指の位置から数え直す（回転が跳ばないように）
    const restart = () => {
      if (pointers.size !== 1) return;
      const [p] = [...pointers.values()];
      lx = sx = p.x;
      ly = sy = p.y;
      vel = 0;
      moved = 99; // タップにはしない
      pinch = 0;
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      restart();
      if (grab?.dragging) {
        drop();
        return;
      }
      grab = null;
      if (pointers.size > 0 || moved > 6) return;
      const hit = pick(e.clientX, e.clientY);
      selectRef.current(hit ? hit.fig.id : null);
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      restart();
      drop();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userZoom = clampZoom(userZoom * Math.exp(e.deltaY * 0.0012));
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointermove", onHover);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ---- 記念撮影：空の色を敷いて、庭を1枚の画像にする ----
    if (handleRef) {
      handleRef.current = {
        snapshot: () => {
          renderer.render(scene, camera);
          const out = document.createElement("canvas");
          out.width = canvas.width;
          out.height = canvas.height;
          const x = out.getContext("2d");
          if (!x) return null;
          const [top, bottom] = SKY_COLORS[time];
          const g = x.createLinearGradient(0, 0, 0, out.height);
          g.addColorStop(0, top);
          g.addColorStop(1, bottom);
          x.fillStyle = g;
          x.fillRect(0, 0, out.width, out.height);
          x.drawImage(canvas, 0, 0);
          const s = out.width / 640;
          x.font = `800 ${Math.round(20 * s)}px ${FONT}`;
          x.fillStyle = time === "night" ? "rgba(255,255,255,0.9)" : "rgba(58,47,40,0.85)";
          x.fillText(`わたしの箱庭  Lv${level.lv} ${level.name}`, 16 * s, out.height - 18 * s);
          try {
            return out.toDataURL("image/png");
          } catch {
            return null;
          }
        },
      };
    }

    // ---- 毎フレーム ----
    let raf = 0, t0 = performance.now(), lastSel: string | null = null;
    const want = new THREE.Vector3();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - t0) / 1000);
      t0 = t;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        fitTo(camera.aspect);
        camera.updateProjectionMatrix();
      }

      // 選んだ模型：はねて、カメラが寄り、足もとに輪
      const sel = selectedRef.current;
      const selFig = sel ? figs.find((f) => f.id === sel) : undefined;
      if (sel !== lastSel) {
        lastSel = sel;
        if (selFig) selFig.jumpT = 0;
      }
      ring.visible = !!selFig;
      if (selFig) {
        ring.position.set(selFig.base.position.x, 0.12, selFig.base.position.z);
        ring.scale.setScalar(1 + Math.sin(t / 220) * 0.06);
        selFig.base.getWorldPosition(want);
      } else {
        want.set(0, 0, 0);
      }
      const k = grab?.dragging ? 0 : 1 - Math.exp(-dt * 4); // つかんでいる間はカメラを止める（指と模型がずれないように）
      target.lerp(want, k);
      zoom += ((selFig ? Math.min(userZoom, 0.55) : userZoom) - zoom) * k;

      if (pointers.size === 0 && !grab) {
        vel *= Math.pow(0.04, dt); // 手を離したあと少し惰性で回る
        garden.rotation.y += vel + (selFig ? 0 : dt * 0.05); // 選んでいないときはゆっくり自転
      }
      if (dropRing.visible) dropRing.scale.setScalar(1 + Math.sin(t / 150) * 0.08);
      for (const f of figs) {
        f.lift += ((grab?.dragging && grab.fig === f ? 0.45 : 0) - f.lift) * (1 - Math.exp(-dt * 12));
        f.base.position.y = 0.05 + f.lift;
        let y = f.y0 + Math.abs(Math.sin(t / 520 + f.phase)) * 0.08;
        if (f.jumpT >= 0) {
          f.jumpT += dt;
          const p = Math.min(1, f.jumpT / 0.7);
          y += Math.sin(Math.PI * p) * 0.9;
          f.holder.rotation.y += dt * 9 * (1 - p);
          if (p >= 1) f.jumpT = -1;
        }
        f.model.position.y = y;
      }
      for (const tick of tickers) tick(t, dt);
      placeCamera();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      if (handleRef) handleRef.current = null;
      scene.traverse((o) => {
        if (o instanceof THREE.Points) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      disposeScene(scene);
      renderer.dispose();
    };
  }, [entries, time, handleRef]);

  return <canvas ref={ref} className="garden3d" aria-label={`箱庭（模型 ${entries.length} 個）`} />;
}

// ===================== 部品 =====================

const toon = (color: string | number, emissive = 0) =>
  new THREE.MeshToonMaterial({ color, emissive: new THREE.Color(emissive) });
const OUTLINE = new THREE.Color(0x3a2f28);

function mesh(geo: THREE.BufferGeometry, color: string | number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, toon(color));
  m.position.set(x, y, z);
  return m;
}

// ---- 光 ----
function addLights(scene: THREE.Scene, time: TimeOfDay) {
  const L = {
    morning: { sky: 0xfff1dc, ground: 0xd8c8a8, hemi: 1.25, sun: 0xffe0b0, sunI: 1.6, pos: [-6, 4, 5] },
    day: { sky: 0xffffff, ground: 0xe8d6bf, hemi: 1.3, sun: 0xffffff, sunI: 1.9, pos: [-3, 6, 4] },
    evening: { sky: 0xfff0e2, ground: 0xd8c4b4, hemi: 1.35, sun: 0xffb27a, sunI: 1.25, pos: [-7, 3, 3] },
    night: { sky: 0x8da2ff, ground: 0x2d2840, hemi: 0.6, sun: 0xb8c8ff, sunI: 0.55, pos: [4, 6, -3] },
  }[time];
  scene.add(new THREE.HemisphereLight(L.sky, L.ground, L.hemi));
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  sun.position.set(L.pos[0], L.pos[1], L.pos[2]);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(time === "night" ? 0x6070c0 : 0xffe2c4, 0.45);
  rim.position.set(4, 2, -3);
  scene.add(rim);
}

// ---- 空：昼は雲と太陽、夜は星と月（庭と一緒には回らない） ----
function sky(time: TimeOfDay, r: number, tickers: Ticker[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  if (time === "night") {
    const pts: number[] = [];
    for (let i = 0; i < 260; i++) {
      const a = (i * 2.39996) % (Math.PI * 2), up = 0.05 + ((i * 0.618) % 1) * 0.5;
      const R = 34;
      pts.push(Math.cos(a) * R * Math.cos(up), R * Math.sin(up), Math.sin(a) * R * Math.cos(up));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true }));
    out.push(stars);
    tickers.push((t) => ((stars.material as THREE.PointsMaterial).opacity = 0.8 + Math.sin(t / 700) * 0.2));
    (stars.material as THREE.PointsMaterial).transparent = true;
    return out;
  }
  // 空の色（太陽の位置）は背景のグラデーションで表す。雲は島のまわりをゆっくり回る
  const clouds = new THREE.Group();
  const cloudColor = time === "evening" ? 0xffe6da : 0xffffff;
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.6 + (j % 2) * 0.25, 16, 12), toon(cloudColor));
      s.position.set(j * 0.65 - 1, (j % 2) * 0.25, (j % 3) * 0.2);
      c.add(s);
    }
    const a = (i / 6) * Math.PI * 2;
    c.position.set(Math.cos(a) * (r + 7), 3.6 + (i % 3) * 0.8, Math.sin(a) * (r + 7));
    c.scale.setScalar(0.7 + (i % 3) * 0.15);
    clouds.add(c);
  }
  tickers.push((_t, dt) => (clouds.rotation.y += dt * 0.02));
  out.push(clouds);
  return out;
}

// ---- 島：芝生（時間で色が変わる）＋土のふち ----
function ground(r: number, time: TimeOfDay) {
  const grassColor = { morning: "#a8dc84", day: "#9fd67a", evening: "#a6d27a", night: "#4f7a55" }[time];
  const g = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.08, r * 0.82, 0.7, 64), toon(time === "night" ? "#6b5040" : "#b8875a"));
  soil.position.y = -0.35;
  const rock = new THREE.Mesh(new THREE.ConeGeometry(r * 0.82, r * 0.7, 48), toon(time === "night" ? "#5a4636" : "#9c7048"));
  rock.position.y = -0.7 - r * 0.35;
  rock.rotation.x = Math.PI;
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 64), toon(grassColor));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 64), toon(time === "night" ? "#3f6446" : "#7cbf57"));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  g.add(soil, rock, grass, rim);
  return g;
}

// ---- 台座：売った＝だいだい、買った＝青、出品中＝灰 ----
function pedestal(color: string) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.1, 40), color, 0, 0.05, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 40), new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex(), 0, 0.105, 0));
  return g;
}

function tree(i: number) {
  const g = new THREE.Group();
  const s = 0.85 + (i % 3) * 0.15;
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 10), "#8a5a3b", 0, 0.15, 0));
  const leafColor = ["#5fb35a", "#4fa055", "#74c25e"][i % 3];
  const top = mesh(new THREE.SphereGeometry(0.22, 16, 12), leafColor, 0, 0.42, 0);
  top.scale.set(1, 1.15, 1);
  g.add(top);
  if (i % 2 === 0) g.add(mesh(new THREE.SphereGeometry(0.14, 12, 10), leafColor, 0.12, 0.58, 0.02));
  g.scale.setScalar(s);
  return g;
}

function flower(i: number) {
  const colors = ["#ff9aa2", "#ffd36e", "#ffffff", "#c9a7ff", "#ff7f6e"];
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), "#4f9a45", 0, 0.07, 0));
  g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), colors[i % colors.length], 0, 0.15, 0));
  g.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), "#ffcc33", 0, 0.165, 0.035));
  return g;
}

function pond() {
  const g = new THREE.Group();
  const edge = mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.04, 40), "#cfc4b2");
  edge.scale.set(1.25, 1, 0.85);
  const water = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 40), "#6cc3e8", 0, 0.01, 0);
  water.scale.set(1.25, 1, 0.85);
  (water.material as THREE.MeshToonMaterial).emissive = new THREE.Color(0x1c4a66);
  g.add(edge, water);
  for (let i = 0; i < 3; i++) {
    const pad = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, 0.4, Math.PI * 1.8), "#4fa055", -0.3 + i * 0.28, 0.04, (i % 2) * 0.18 - 0.08);
    g.add(pad);
  }
  g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), "#ff9aa2", -0.3, 0.07, -0.08));
  return g;
}

function stone(i: number) {
  const s = mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.03, 12), i % 2 ? "#d8d0c4" : "#c8bfb2");
  s.scale.set(1, 1, 0.75 + (i % 3) * 0.1);
  return s;
}

function fence(r: number) {
  const g = new THREE.Group();
  const count = Math.round((Math.PI * 2 * r) / 0.42);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    if (Math.abs(Math.sin(a / 2)) < 0.08) continue; // 手前に入り口をあける
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.26, 0.05), "#f3e6cf", Math.sin(a) * r, 0.18, Math.cos(a) * r));
  }
  for (const y of [0.14, 0.25]) {
    const rail = mesh(new THREE.TorusGeometry(r, 0.014, 6, 96, Math.PI * 2 - 0.34), "#e8d6b8", 0, y, 0);
    rail.rotation.x = Math.PI / 2;
    rail.rotation.z = Math.PI / 2 + 0.17;
    g.add(rail);
  }
  return g;
}

function house() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), "#fff3e0", 0, 0.2, 0));
  const roof = mesh(new THREE.ConeGeometry(0.43, 0.32, 4), "#e05a4a", 0, 0.56, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.2, 0.02), "#8a5a3b", 0, 0.1, 0.23));
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), "#9fd3ff", 0.15, 0.25, 0.23));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), "#b0a090", 0.14, 0.68, -0.08));
  return g;
}

function windmill(tickers: Ticker[]) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.7, 12), "#f6efe2", 0, 0.35, 0));
  g.add(mesh(new THREE.ConeGeometry(0.16, 0.2, 12), "#7aa6d8", 0, 0.8, 0));
  const blades = new THREE.Group();
  blades.position.set(0, 0.68, 0.17);
  for (let i = 0; i < 4; i++) {
    const b = mesh(new THREE.BoxGeometry(0.07, 0.42, 0.015), "#ffffff", 0, 0.21, 0);
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(b);
    blades.add(arm);
  }
  blades.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), "#8a5a3b"));
  g.add(blades);
  tickers.push((_t, dt) => (blades.rotation.z += dt * 1.2));
  return g;
}

function rainbow(r: number) {
  const g = new THREE.Group();
  const colors = ["#ff6b6b", "#ffb36b", "#ffe66b", "#7be08a", "#6bb8ff", "#a98bff"];
  colors.forEach((c, i) => {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.75 + i * 0.13, 0.065, 8, 64, Math.PI),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    arc.position.set(0, 0, -r * 0.55);
    g.add(arc);
  });
  return g;
}

function flag(tickers: Ticker[]) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 8), "#d8d0c4", 0, 0.4, 0));
  const cloth = mesh(new THREE.BoxGeometry(0.3, 0.18, 0.01), "#ff7f6e", 0.15, 0.7, 0);
  g.add(cloth);
  tickers.push((t) => (cloth.rotation.y = Math.sin(t / 300) * 0.35));
  return g;
}

function lantern(withLight: boolean) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8), "#5a4636", 0, 0.22, 0));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  lamp.position.y = 0.5;
  g.add(lamp);
  if (withLight) {
    const light = new THREE.PointLight(0xffc870, 2.2, 3.2, 1.6);
    light.position.y = 0.5;
    g.add(light);
  }
  return g;
}

function butterfly(i: number, r: number, tickers: Ticker[]) {
  const g = new THREE.Group();
  const color = ["#ffd36e", "#ff9aa2", "#ffffff"][i % 3];
  const wingMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const left = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), wingMat);
  const right = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), wingMat.clone());
  left.position.x = -0.06;
  right.position.x = 0.06;
  const lw = new THREE.Group(), rw = new THREE.Group();
  lw.add(left);
  rw.add(right);
  g.add(lw, rw, mesh(new THREE.CapsuleGeometry(0.012, 0.06, 4, 8), "#3a2f28"));
  g.children[2].rotation.x = Math.PI / 2;
  const R = r * (0.45 + i * 0.12), speed = 0.25 + i * 0.08, phase = i * 2.1;
  tickers.push((t) => {
    const a = (t / 1000) * speed + phase;
    g.position.set(Math.cos(a) * R, 0.9 + Math.sin(t / 400 + i) * 0.25, Math.sin(a) * R);
    g.rotation.y = -a;
    const flap = Math.sin(t / 60 + i) * 0.9;
    lw.rotation.z = flap;
    rw.rotation.z = -flap;
    lw.rotation.x = rw.rotation.x = -Math.PI / 2.4;
  });
  return g;
}

// 新しく並んだ模型のまわりを回るキラキラ
function sparkles(height: number, tickers: Ticker[], seed: number) {
  const g = new THREE.Group();
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  if (x) {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.3, "rgba(255,230,120,0.9)");
    gr.addColorStop(1, "rgba(255,230,120,0)");
    x.fillStyle = gr;
    x.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, rr = k % 2 ? 9 : 30;
      x.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr);
    }
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  const items: THREE.Sprite[] = [];
  for (let k = 0; k < 6; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.setScalar(0.18);
    g.add(s);
    items.push(s);
  }
  tickers.push((t) => {
    items.forEach((s, k) => {
      const a = t / 900 + (k * Math.PI) / 3 + seed;
      s.position.set(Math.cos(a) * 0.62, 0.25 + ((k / 6 + t / 3000) % 1) * (height + 0.2), Math.sin(a) * 0.62);
      (s.material as THREE.SpriteMaterial).opacity = 0.5 + 0.5 * Math.sin(t / 200 + k);
    });
  });
  return g;
}

// 模型の頭の上の名札（売った/買った/出品中＋商品名、新しい模型には NEW）
function nameTag(title: string, tag: GardenEntry["tag"], isNew: boolean) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const x = c.getContext("2d");
  if (x) {
    const short = [...title].length > 12 ? [...title].slice(0, 11).join("") + "…" : title;
    x.fillStyle = "rgba(255,255,255,0.94)";
    roundRect(x, 4, 24, 504, 96, 40);
    x.fill();
    x.strokeStyle = `#${OUTLINE.getHexString()}`;
    x.globalAlpha = 0.15;
    x.lineWidth = 4;
    x.stroke();
    x.globalAlpha = 1;
    x.fillStyle = TAG_COLOR[tag];
    roundRect(x, 16, 36, 112, 72, 30);
    x.fill();
    x.font = `800 34px ${FONT}`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = "#fff";
    x.fillText(TAG_TEXT[tag], 72, 74);
    const room = isNew ? 270 : 350;
    if (isNew) {
      x.fillStyle = "#ff5a5f";
      roundRect(x, 420, 44, 78, 56, 24);
      x.fill();
      x.fillStyle = "#fff";
      x.font = `900 26px ${FONT}`;
      x.fillText("NEW", 459, 74);
    }
    x.fillStyle = "#3a2f28";
    x.textAlign = "left";
    let fs = 38;
    x.font = `700 ${fs}px ${FONT}`;
    const w = x.measureText(short).width;
    if (w > room) {
      fs *= room / w;
      x.font = `700 ${fs}px ${FONT}`;
    }
    x.fillText(short, 144, 74);
  }
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
