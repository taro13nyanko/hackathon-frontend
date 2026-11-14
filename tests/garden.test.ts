// 箱庭の決まり（src/garden.ts）の単体テスト。three.js も画面も使わない部分だけを確かめる。
// 実行：npm test（Node 24 の node:test。TypeScript は Node が型を取り除いてそのまま読む）
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, TAG_COLOR, TAG_TEXT, gardenLevel, loadSeen, saveSeen, timeOfDayAt } from "../src/garden.ts";

// ---- 育つ島のレベル ----

test("模型の数ごとのレベルと名前（しきい値 0・3・6・10・15）", () => {
  const cases: [number, number, string][] = [
    [0, 1, "はじまりの小島"],
    [2, 1, "はじまりの小島"],
    [3, 2, "芽吹きの庭"],
    [5, 2, "芽吹きの庭"],
    [6, 3, "にぎやかな広場"],
    [9, 3, "にぎやかな広場"],
    [10, 4, "ちいさな町"],
    [14, 4, "ちいさな町"],
    [15, 5, "ものがたりの島"],
    [999, 5, "ものがたりの島"],
  ];
  for (const [count, lv, name] of cases) {
    const got = gardenLevel(count);
    assert.equal(got.lv, lv, `模型 ${count} 個のレベル`);
    assert.equal(got.name, name, `模型 ${count} 個の名前`);
  }
});

test("次のレベルまでの残りと進み具合", () => {
  assert.deepEqual(
    { toNext: gardenLevel(0).toNext, progress: gardenLevel(0).progress, next: gardenLevel(0).next?.name },
    { toNext: 3, progress: 0, next: "芽吹きの庭" },
  );
  const mid = gardenLevel(8); // Lv3（6〜9）の途中
  assert.equal(mid.toNext, 2);
  assert.equal(mid.progress, 0.5);
  assert.equal(mid.next?.unlock, "家と風車");
});

test("最高レベルでは次が無く、進み具合は 1", () => {
  const top = gardenLevel(15);
  assert.equal(top.next, null);
  assert.equal(top.toNext, 0);
  assert.equal(top.progress, 1);
});

test("進み具合はどの数でも 0 以上 1 未満（最高レベルだけ 1）", () => {
  for (let n = 0; n <= 20; n++) {
    const { progress, next } = gardenLevel(n);
    if (next) assert.ok(progress >= 0 && progress < 1, `模型 ${n} 個：${progress}`);
    else assert.equal(progress, 1);
  }
});

test("レベルのしきい値は小さい順で、最初は 0", () => {
  assert.equal(LEVELS[0].min, 0);
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].min > LEVELS[i - 1].min);
});

// ---- 台座の色と文字 ----

test("売った・買った・出品中は、文字も色もそれぞれ違う", () => {
  assert.deepEqual(TAG_TEXT, { sold: "売った", selling: "出品中", bought: "買った" });
  assert.equal(new Set(Object.values(TAG_COLOR)).size, 3);
});

// ---- 朝昼夕夜（端末の時刻で決まる。境目を確かめる） ----

const at = (h: number, m = 0) => new Date(2026, 11, 12, h, m);

test("時間帯の境目（5時・10時・16時・19時）", () => {
  const cases: [number, number, string][] = [
    [4, 59, "night"],
    [5, 0, "morning"],
    [9, 59, "morning"],
    [10, 0, "day"],
    [15, 59, "day"],
    [16, 0, "evening"],
    [18, 59, "evening"],
    [19, 0, "night"],
    [0, 0, "night"],
    [23, 59, "night"],
  ];
  for (const [h, m, want] of cases) assert.equal(timeOfDayAt(at(h, m)), want, `${h}:${String(m).padStart(2, "0")}`);
});

// ---- 「NEW」の記録（localStorage。保存できなくても壊れない） ----

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

let store: MemoryStorage;
const setStorage = (s: unknown) => Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });

beforeEach(() => {
  store = new MemoryStorage();
  setStorage(store);
});

test("初めて開いたときは null（全部を NEW にしない）", () => {
  assert.equal(loadSeen("u1"), null);
});

test("保存した ID を読み戻せる。人ごとに分かれる", () => {
  saveSeen("u1", ["a", "b"]);
  assert.deepEqual([...(loadSeen("u1") ?? [])], ["a", "b"]);
  assert.equal(loadSeen("u2"), null);
});

test("保存は新しい 500 件まで", () => {
  const ids = Array.from({ length: 600 }, (_, i) => `id${i}`);
  saveSeen("u1", ids);
  const seen = loadSeen("u1")!;
  assert.equal(seen.size, 500);
  assert.ok(seen.has("id599") && seen.has("id100") && !seen.has("id99"));
});

test("壊れた記録や文字列以外は無視する", () => {
  store.setItem("garden-seen:u1", "{壊れた");
  assert.equal(loadSeen("u1"), null);
  store.setItem("garden-seen:u1", JSON.stringify({ not: "array" }));
  assert.deepEqual([...loadSeen("u1")!], []);
  store.setItem("garden-seen:u1", JSON.stringify(["ok", 1, null, "ok2"]));
  assert.deepEqual([...loadSeen("u1")!], ["ok", "ok2"]);
});

test("localStorage が使えない環境（プライベートモードなど）でも例外を出さない", () => {
  setStorage({
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  });
  assert.doesNotThrow(() => saveSeen("u1", ["a"]));
  assert.equal(loadSeen("u1"), null);
});
