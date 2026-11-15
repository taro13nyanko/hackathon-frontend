import type { GardenSpot, Item, Purchase } from "./api";
import type { GardenEntry, GardenLevel, GardenTag } from "./garden";

// ホーム（A-1）と下部タブの決まり（画面を使わない部分）。App.tsx から使い、tests/home.test.ts で確かめる。
// ここでは値を import しない（node:test が型だけ取り除いてそのまま読めるように）。

// ---- 箱庭の中身：自分の出品と購入から、模型の並び（GardenEntry）を作る ----
export type GardenData = {
  entries: GardenEntry[]; // 模型のある物（古い順）
  missing: Item[]; // 模型がまだの物
  purchases: Item[]; // 購入履歴（おすすめに渡す。新しい順のまま）
  items: Record<string, Item>; // id → 商品（フィギュア一覧のサムネに使う）
};

export const EMPTY_GARDEN: GardenData = { entries: [], missing: [], purchases: [], items: {} };

// buildGarden は GET /me/items・/me/purchases・/me/garden の結果を箱庭の並びにする。
// seen は前に箱庭を開いたときに見た模型（null は初めて：全部を NEW にはしない）。
// 同じ商品が出品と購入の両方にあれば、先に出てきた（古い）方だけを使う。
export function buildGarden(mine: Item[], bought: Purchase[], spots: GardenSpot[], seen: Set<string> | null): GardenData {
  const spotOf = new Map(spots.map((s) => [s.item_id, { x: s.x, z: s.z }]));
  // 古い順に並べる（思い出が積もっていく順）
  const all = [
    ...mine.map((it) => ({ it, tag: (it.status === "sold" ? "sold" : "selling") as GardenTag, at: it.created_at, price: it.price })),
    ...bought.map((p) => ({ it: p.item, tag: "bought" as GardenTag, at: p.created_at, price: p.price })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const entries: GardenEntry[] = [];
  const missing: Item[] = [];
  const items: Record<string, Item> = {};
  for (const { it, tag, at, price } of all) {
    if (items[it.id]) continue;
    items[it.id] = it;
    if (it.figure)
      entries.push({ id: it.id, title: it.title, figure: it.figure, tag, at, price, isNew: seen !== null && !seen.has(it.id), spot: spotOf.get(it.id) });
    else missing.push(it);
  }
  return { entries, missing, purchases: bought.map((p) => p.item), items };
}

// ---- レベルカード：％はバーの幅と同じ数から出す（表示がずれないように） ----
export function levelPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

// 箱庭カードの下端のチップ（N = 模型の総数）
export const collectionText = (n: number) => `Geminiがフィギュア化 ・ ${n}体コレクション済み`;

// フィギュア一覧で、新しい物を上に出す（NEW → 新しい順）。元の並びは変えない。
export function figureRows(entries: GardenEntry[]): GardenEntry[] {
  return [...entries].sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || b.at.localeCompare(a.at));
}

// ---- 下部タブ（スマホ） ----
export type TabKey = "home" | "search" | "sell" | "messages" | "mypage";
export const TABS: { key: TabKey; label: string; needsLogin: boolean }[] = [
  { key: "home", label: "ホーム", needsLogin: false },
  { key: "search", label: "さがす", needsLogin: false },
  { key: "sell", label: "出品", needsLogin: true },
  { key: "messages", label: "メッセージ", needsLogin: true },
  { key: "mypage", label: "マイページ", needsLogin: true },
];

// tabOf は今の画面がどのタブの中か（詳細・購入などどれでもない画面は null：どのタブも「現在地」にしない）
export function tabOf(view: string): TabKey | null {
  switch (view) {
    case "list":
    case "garden":
      return "home";
    case "search":
      return "search";
    case "sell":
      return "sell";
    case "inbox":
    case "chat":
      return "messages";
    case "mypage":
      return "mypage";
    default:
      return null;
  }
}

// 未ログインでログインが要るタブを押したときの一言（押したあと Google のログインを出す）
export const LOGIN_PROMPT: Record<Exclude<TabKey, "home" | "search">, string> = {
  sell: "出品するにはログインしてください",
  messages: "メッセージを見るにはログインしてください",
  mypage: "マイページを見るにはログインしてください",
};

// 「買うと箱庭に増える」チップ。模型があれば「模型つき」、写真があれば「模型をつくれる」、どちらも無ければ出さない（""）
export function gardenChipText(item: Pick<Item, "figure" | "photo_image_id">): string {
  if (item.figure) return "買うと箱庭に増える（模型つき）";
  if (item.photo_image_id) return "買うと箱庭に増える（写真から模型をつくれます）";
  return "";
}

// おすすめの補足。理由がすべて「まずはここから」（履歴が無い人）なら、箱庭・購入履歴は使っていないのでそう書かない
export const REC_SUB = "箱庭と購入履歴から選んだ実在の出品";
export const REC_SUB_STARTER = "新着・模型つき・手ごろな実在の出品";
export function recSubText(kinds: string[]): string {
  return kinds.length > 0 && kinds.every((k) => k === "starter") ? REC_SUB_STARTER : REC_SUB;
}

// ---- 買う流れ（商品詳細・購入確認・購入完了） ----

// 詳細の「あと{toNext}個で進化」チップ。次のレベルが無い（いちばん大きな島）なら出さない（""）
export function levelChipText(level: Pick<GardenLevel, "next" | "toNext">): string {
  return level.next && level.toNext > 0 ? `あと${level.toNext}個で進化` : "";
}

// 購入確認の「買うと箱庭に増えます」チップ（gardenChipText のていねい語。どちらも無ければ出さない）
export function confirmChipText(item: Pick<Item, "figure" | "photo_image_id">): string {
  if (item.figure) return "買うと箱庭に増えます";
  if (item.photo_image_id) return "買ったあと写真から模型をつくると、箱庭に増えます";
  return "";
}

// 購入完了で使う「購入後の模型の数」。箱庭に並ぶのは模型のある物だけ。
// 読み直しが終わる前（買った物がまだ entries に無い）でも、終わった後でも同じ数になるようにする
export function countAfterBuy(entries: Pick<GardenEntry, "id">[], item: Pick<Item, "id" | "figure">): number {
  if (!item.figure || entries.some((e) => e.id === item.id)) return entries.length;
  return entries.length + 1;
}

// 詳細ページのおすすめ帯の補足。「この商品に近い」（similar）と、箱庭・購入履歴からの理由、
// 履歴の無い人向け（starter）の組み合わせで、実際に使った物だけを書く
export function detailRecSub(kinds: string[]): string {
  const similar = kinds.includes("similar");
  const others = kinds.filter((k) => k !== "similar");
  const history = others.some((k) => k !== "starter");
  if (similar && others.length === 0) return "この商品に近い、いま買える実在の出品";
  if (!similar) return recSubText(others);
  return history ? "この商品に近い物と、箱庭・購入履歴から選んだ実在の出品" : "この商品に近い物と、新着・模型つき・手ごろな実在の出品";
}
