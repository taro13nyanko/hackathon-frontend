import type { Figure } from "./api";

// 箱庭の決まり（three.js を使わない部分）。画面（App.tsx）と 3D（Garden3D.tsx）の両方から使う。

export type GardenTag = "sold" | "selling" | "bought";

export type GardenEntry = {
  id: string;
  title: string;
  figure: Figure;
  tag: GardenTag;
  price: number;
  at: string; // 売り買い・出品した日時（ISO 8601）
  isNew?: boolean; // 前に箱庭を開いたときには無かった模型
  // つかんで動かした置き場所（島の中心からの位置）。無ければマス目に並ぶ。
  // 動かしたら画面がここを書き換える（時間帯を変えて描き直しても、動かした場所に残るように）
  spot?: { x: number; z: number };
};

export const TAG_TEXT: Record<GardenTag, string> = { sold: "売った", selling: "出品中", bought: "買った" };
export const TAG_COLOR: Record<GardenTag, string> = { sold: "#e8833a", selling: "#8a8f98", bought: "#3a8fe8" };

// ---- 育つ島：模型の数でレベルが上がり、飾りが増える ----
export const LEVELS = [
  { min: 0, name: "はじまりの小島", unlock: "木と花" },
  { min: 3, name: "芽吹きの庭", unlock: "池とちょうちょ" },
  { min: 6, name: "にぎやかな広場", unlock: "小道と柵" },
  { min: 10, name: "ちいさな町", unlock: "家と風車" },
  { min: 15, name: "ものがたりの島", unlock: "虹と旗" },
] as const;

export type GardenLevel = { lv: number; name: string; next: (typeof LEVELS)[number] | null; toNext: number; progress: number };

export function gardenLevel(count: number): GardenLevel {
  let i = 0;
  while (i + 1 < LEVELS.length && count >= LEVELS[i + 1].min) i++;
  const next = LEVELS[i + 1] ?? null;
  const from = LEVELS[i].min;
  return {
    lv: i + 1,
    name: LEVELS[i].name,
    next,
    toNext: next ? next.min - count : 0,
    progress: next ? (count - from) / (next.min - from) : 1,
  };
}

// ---- 空と時間 ----
export type TimeOfDay = "morning" | "day" | "evening" | "night";
export const TIME_TEXT: Record<TimeOfDay, string> = { morning: "朝", day: "昼", evening: "夕方", night: "夜" };

// 空のグラデーション（上, 下）
export const SKY_COLORS: Record<TimeOfDay, [string, string]> = {
  morning: ["#ffe2c8", "#e3f3ff"],
  day: ["#bfe3ff", "#f4fbff"],
  evening: ["#ff9e7a", "#ffd9a8"],
  night: ["#141a3a", "#3a3f6e"],
};

export function timeOfDayAt(d: Date): TimeOfDay {
  const h = d.getHours();
  if (h >= 5 && h < 10) return "morning";
  if (h >= 10 && h < 16) return "day";
  if (h >= 16 && h < 19) return "evening";
  return "night";
}

// ---- 「NEW」：前に開いたときに見た模型を覚える（この端末だけ。保存できなくても箱庭は動く） ----
const seenKey = (userId: string) => `garden-seen:${userId}`;

export function loadSeen(userId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    if (raw === null) return null; // 初めて開いた（全部を NEW にはしない）
    const ids: unknown = JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return null;
  }
}

export function saveSeen(userId: string, ids: string[]) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify(ids.slice(-500)));
  } catch {
    // 保存できない環境（プライベートモードなど）では、NEW が出ないだけ
  }
}
