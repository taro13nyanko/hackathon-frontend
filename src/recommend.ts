import type { Figure, Item } from "./api";
// 拡張子つき：npm test（Node が .ts をそのまま読む）でも解決できるように
import { gardenLevel, type GardenEntry } from "./garden.ts";

// 「あなたへのおすすめ」の決まり（画面を使わない部分）。広告ではなく、アプリ内で実際に売っている商品だけを並べ替える。
// 有料で順位を上げる仕組み・偽の残り個数・急がせる文言は作らない。新しいテーブルも使わない（一覧・箱庭・購入履歴・端末の閲覧履歴だけ）。

// similar は詳細ページの「この商品に近い」（detailRecs だけが付ける）
export type RecReason = { kind: "color" | "level" | "category" | "seen" | "budget" | "new" | "starter" | "similar"; text: string };
export type Rec = { item: Item; reason: RecReason };
export type RecInput = {
  items: Item[]; // 通常一覧の商品（GET /items の結果）
  viewerId?: string; // ログイン中の自分の users.id（自分の出品を除くため。未ログインは undefined）
  garden: GardenEntry[]; // 箱庭の中身（未ログインは []）
  purchases: Item[]; // 購入履歴（未ログインは []）
  seenTitles: string[]; // 最近見た商品のタイトル（新しい順、端末の localStorage。最大20件）
  query?: string; // 検索語（検索0件時のフォールバックで使う）
  excludeIds?: string[]; // 除外したい商品（詳細ページの今の商品など）
  now: Date; // 「新着」の判定用（テストで固定できるように引数で渡す）
};

// ---- カテゴリ：タイトル・説明文に出る語の小さな辞書 ----
// 日本語の複合語は後ろの語が中心（「テーブルランプ」は照明、「デスクライト」も照明）なので、
// タイトルでいちばん後ろに出てくる語のカテゴリにする（同じ位置なら長い語）。タイトルで決まらなければ説明文で同じことをする。
// 「本」1文字は「本体」「日本」に当たるので入れない。
export const CATEGORIES: { name: string; words: string[] }[] = [
  { name: "本", words: ["文庫", "単行本", "小説", "漫画", "マンガ", "コミック", "雑誌", "参考書", "教科書", "絵本", "図鑑", "書籍"] },
  { name: "文房具", words: ["文房具", "ボールペン", "ペンケース", "筆箱", "鉛筆", "消しゴム", "ノート", "手帳", "定規", "万年筆", "ペン"] },
  { name: "家具", words: ["椅子", "チェア", "デスク", "机", "テーブル", "本棚", "棚", "ソファ", "ベッド", "スツール", "家具"] },
  { name: "照明", words: ["デスクライト", "ライト", "ランプ", "照明", "ランタン", "電球"] },
  { name: "服", words: ["Tシャツ", "シャツ", "パーカー", "ジャケット", "コート", "ワンピース", "スカート", "ニット", "セーター", "パンツ", "洋服", "服"] },
  { name: "靴", words: ["スニーカー", "シューズ", "ブーツ", "サンダル", "パンプス", "靴"] },
  { name: "食器", words: ["食器", "マグカップ", "マグ", "カップ", "茶碗", "湯のみ", "グラス", "ボウル", "皿", "箸"] },
  { name: "家電", words: ["家電", "イヤホン", "ヘッドホン", "スピーカー", "充電器", "ドライヤー", "扇風機", "カメラ", "ゲーム機", "キーボード", "マウス"] },
  { name: "おもちゃ", words: ["おもちゃ", "ぬいぐるみ", "フィギュア", "プラモデル", "パズル", "ブロック", "人形", "ゲーム"] },
];

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

// categoryOf はタイトルと説明文からカテゴリ名を推定する（当たらなければ null）。
export function categoryOf(title: string, description = ""): string | null {
  return lastCategory(norm(title)) ?? lastCategory(norm(description));
}

function lastCategory(text: string): string | null {
  let best: string | null = null;
  let bestEnd = -1;
  let bestLen = 0;
  for (const c of CATEGORIES) {
    for (const w of c.words.map(norm)) {
      const at = text.lastIndexOf(w);
      if (at < 0) continue;
      const end = at + w.length;
      if (end > bestEnd || (end === bestEnd && w.length > bestLen)) [best, bestEnd, bestLen] = [c.name, end, w.length];
    }
  }
  return best;
}

// ---- 色：模型の部品の色を「色の系統」にまとめる ----
export type ColorFamily = "赤" | "橙" | "黄" | "緑" | "青" | "紫" | "桃" | "茶" | "白" | "灰" | "黒";
// 白・灰・黒は「箱庭にない色」の理由にしない（どの模型にも出やすいので）
const CHROMATIC: ReadonlySet<ColorFamily> = new Set<ColorFamily>(["赤", "橙", "黄", "緑", "青", "紫", "桃", "茶"]);

// colorFamily は #rgb / #rrggbb を色の系統にする（読めなければ null）。
export function colorFamily(hex: string): ColorFamily | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h6 = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (l >= 0.92) return "白";
  if (l <= 0.12) return "黒";
  if (s < 0.15) return "灰";
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return l > 0.75 ? "桃" : "赤";
  if (hue < 45) return l < 0.45 ? "茶" : "橙";
  if (hue < 70) return "黄";
  if (hue < 170) return "緑";
  if (hue < 260) return "青";
  if (hue < 300) return "紫";
  return "桃";
}

// figureColors は模型の主な色（体積のおよそ15%以上を占める系統）。文字の札（label）は数えない。
export function figureColors(fig: Figure | null): Set<ColorFamily> {
  const weight = new Map<ColorFamily, number>();
  let total = 0;
  for (const p of fig?.parts ?? []) {
    if (p.shape === "label" || !p.color) continue;
    const fam = colorFamily(p.color);
    if (!fam) continue;
    const w = Math.abs([...p.size, ...(p.scale ?? [])].reduce((a, x) => a * (x || 1), 1)) || 1e-6;
    weight.set(fam, (weight.get(fam) ?? 0) + w);
    total += w;
  }
  return new Set([...weight].filter(([, w]) => w / total >= 0.15).map(([f]) => f));
}

const figureShapes = (fig: Figure | null) => new Set((fig?.parts ?? []).filter((p) => p.shape !== "label").map((p) => p.shape));

// ---- 語の近さ：文字バイグラムの重なり ----
// ひらがなだけの2文字（「です」「ます」など）は数えない。
export function bigrams(text: string): Set<string> {
  const chars = [...norm(text).replace(/[^\p{L}\p{N}]/gu, "")];
  if (chars.length === 1) return new Set(chars);
  const out = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const bg = chars[i] + chars[i + 1];
    if (!/^[\p{Script=Hiragana}ー]+$/u.test(bg)) out.add(bg);
  }
  return out;
}

const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

// titleSimilarity は2つの文の近さ（Dice 係数、0〜1）。
export function titleSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  return x.size + y.size === 0 ? 0 : (2 * overlap(x, y)) / (x.size + y.size);
}

// nearQuery は検索語と商品（名前・説明）が1つでも語を共有するか。検索0件のおすすめの見出しに「「語」に近い」と書いてよいかの判定に使う
export function nearQuery(query: string, it: Pick<Item, "title" | "description">): boolean {
  const q = bigrams(query);
  return q.size > 0 && overlap(q, bigrams(`${it.title} ${it.description}`)) > 0;
}

// ---- 除外：おすすめに出してよい商品か ----
// 売り切れ・自分の出品・非公開・見本データ（出品者なし＝買えない）・指定された商品は出さない。
export function isRecommendable(it: Item, viewerId: string | undefined, exclude: ReadonlySet<string>): boolean {
  if (it.status !== "on_sale") return false;
  if (it.seller === null) return false;
  if (viewerId !== undefined && it.seller.id === viewerId) return false;
  if (it.moderation_status === "hidden") return false;
  return !exclude.has(it.id);
}

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const NEW_DAYS = 3; // 出品から3日以内を「新着」とする
const isNewAt = (it: Item, now: Date) => {
  const t = Date.parse(it.created_at);
  return !Number.isNaN(t) && now.getTime() - t <= NEW_DAYS * 24 * 3600 * 1000 && now.getTime() >= t;
};

export const STARTER: RecReason = { kind: "starter", text: "まずはここから" };

// 理由の強さが同じときの優先順（仕様の並び）
const REASON_ORDER: RecReason["kind"][] = ["color", "level", "category", "seen", "budget", "new"];

type Scored = { item: Item; score: number; reason: RecReason; category: string | null };

const EPS = 1e-9;
// byScore は点数の高い順。同点は新しい順 → id の順（同じ入力なら必ず同じ並び）
function byScore(a: Scored, b: Scored): number {
  if (Math.abs(a.score - b.score) > EPS) return b.score - a.score;
  if (a.item.created_at !== b.item.created_at) return a.item.created_at < b.item.created_at ? 1 : -1;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

const candidatesOf = (input: RecInput, extraExclude: string[] = []) => {
  const exclude = new Set([...(input.excludeIds ?? []), ...extraExclude]);
  const seenIds = new Set<string>();
  return input.items.filter((it) => {
    if (seenIds.has(it.id)) return false; // 同じ商品が2回来ても1回だけ
    seenIds.add(it.id);
    return isRecommendable(it, input.viewerId, exclude);
  });
};

const hasHistory = (input: RecInput) => input.garden.length > 0 || input.purchases.length > 0 || input.seenTitles.length > 0;

// scoreAll は候補ごとの点数と、いちばん効いた理由を出す。
function scoreAll(input: RecInput, cands: Item[]): Scored[] {
  const queryBg = input.query?.trim() ? bigrams(input.query) : null;
  const queryScore = (it: Item) => {
    if (!queryBg || queryBg.size === 0) return 0;
    const target = bigrams(`${it.title} ${it.description}`);
    return (5 * overlap(queryBg, target)) / queryBg.size; // 検索語に近いことを最優先
  };
  const prices = cands.map((it) => it.price);
  const midPrice = median(prices);

  // 履歴が無い人：新着＋模型あり＋低価格を「まずはここから」
  if (!hasHistory(input)) {
    return cands.map((it) => {
      let score = queryScore(it);
      if (isNewAt(it, input.now)) score += 1.5;
      if (it.figure) score += 1.5;
      if (it.price <= midPrice) score += 1;
      if (it.photo_image_id) score += 0.5;
      if (it.price > midPrice * 3) score -= 2;
      return { item: it, score, reason: STARTER, category: categoryOf(it.title, it.description) };
    });
  }

  // 箱庭にあるもの
  const gardenColors = new Set<ColorFamily>();
  const gardenShapes = new Set<string>();
  for (const e of input.garden) {
    figureColors(e.figure).forEach((c) => gardenColors.add(c));
    figureShapes(e.figure).forEach((s) => gardenShapes.add(s));
  }
  // 買った・売った・出品した物のカテゴリと語（箱庭はタイトルだけ、購入履歴は説明文も）
  const historyTexts = [...input.garden.map((e) => ({ title: e.title, description: "" })), ...input.purchases];
  const collecting = new Set(historyTexts.map((h) => categoryOf(h.title, h.description)).filter((c): c is string => c !== null));
  const historyBg = new Set<string>();
  for (const h of historyTexts) for (const bg of bigrams(`${h.title} ${h.description}`)) historyBg.add(bg);
  const lvl = gardenLevel(input.garden.length);
  const nearLevel = lvl.next !== null && lvl.toNext <= 2; // 次のレベルまであと少し
  const budget = median(input.purchases.map((p) => p.price)); // 購入履歴の価格の中央値（無ければ NaN）

  return cands.map((it) => {
    const category = categoryOf(it.title, it.description);
    const hits: { kind: RecReason["kind"]; pts: number; text: string }[] = [];
    let score = queryScore(it);

    if (input.garden.length > 0) {
      const newColor = [...figureColors(it.figure)].some((c) => CHROMATIC.has(c) && !gardenColors.has(c));
      if (newColor) hits.push({ kind: "color", pts: 3, text: "箱庭にない色" });
      if ([...figureShapes(it.figure)].some((s) => !gardenShapes.has(s))) score += 1; // 新しい形（理由の札は無い）
      if (category !== null && !collecting.has(category)) score += 1.5; // まだ無いカテゴリ（理由の札は無い）
    }
    // 買った／売った物の語に近い（タイトルのバイグラムのうち履歴に出る割合）
    const titleBg = bigrams(it.title);
    const wordSim = titleBg.size ? overlap(titleBg, historyBg) / titleBg.size : 0;
    if (category !== null && collecting.has(category)) hits.push({ kind: "category", pts: 2 + 2 * wordSim, text: `${category}集め中` });
    else score += 2 * wordSim; // 近いがカテゴリが分からない／違うときは点数だけ

    // 見たその商品（タイトルが同じ）は「近い」に数えない（見た物そのものを「近い」と出さないように）
    const seenSim = Math.max(0, ...input.seenTitles.filter((t) => t.trim() !== it.title.trim()).map((t) => titleSimilarity(it.title, t)));
    if (seenSim >= 0.3) hits.push({ kind: "seen", pts: 2.5 * seenSim, text: "前に見た商品に近い" });

    if (nearLevel && it.figure && it.price <= midPrice) hits.push({ kind: "level", pts: 2, text: `あと${lvl.toNext}個で進化` });
    if (!Number.isNaN(budget) && it.price <= budget) hits.push({ kind: "budget", pts: 1, text: "予算内" });
    if (isNewAt(it, input.now)) hits.push({ kind: "new", pts: 1, text: "新着" });

    if (it.photo_image_id) score += 0.5;
    if (it.figure) score += 0.5;
    if (it.price > midPrice * 3) score -= 2; // 極端に高い

    score += hits.reduce((a, h) => a + h.pts, 0);
    hits.sort((a, b) => (Math.abs(a.pts - b.pts) > EPS ? b.pts - a.pts : REASON_ORDER.indexOf(a.kind) - REASON_ORDER.indexOf(b.kind)));
    // 理由の札が1つも当たらない商品は「まずはここから」にする
    const reason: RecReason = hits.length ? { kind: hits[0].kind, text: hits[0].text } : STARTER;
    return { item: it, score, reason, category };
  });
}

// recommend はおすすめを最大 limit 件返す。同じカテゴリは limit の半分まで（カテゴリが分からない物は数えない）。
export function recommend(input: RecInput, limit: number): Rec[] {
  if (limit <= 0) return [];
  const cap = Math.max(1, Math.floor(limit / 2));
  const scored = scoreAll(input, candidatesOf(input)).sort(byScore);
  const perCategory = new Map<string, number>();
  const out: Rec[] = [];
  for (const s of scored) {
    if (out.length >= limit) break;
    if (s.category !== null) {
      const n = perCategory.get(s.category) ?? 0;
      if (n >= cap) continue;
      perCategory.set(s.category, n + 1);
    }
    out.push({ item: s.item, reason: s.reason });
  }
  return out;
}

// similarTo は詳細ページの「類似商品」。同じカテゴリ・近いタイトルが上。似ていない物は出さない（数合わせをしない）。
export function similarTo(item: Item, input: RecInput, limit: number): Rec[] {
  if (limit <= 0) return [];
  const category = categoryOf(item.title, item.description);
  const reason: RecReason = { kind: "seen", text: "前に見た商品に近い" }; // いま見ている商品に近い
  const scored: Scored[] = [];
  for (const it of candidatesOf(input, [item.id])) {
    const cat = categoryOf(it.title, it.description);
    const sim = titleSimilarity(item.title, it.title);
    const sameCat = category !== null && cat === category;
    if (!sameCat && sim === 0) continue;
    // 価格が近いほど少し上（同じ価格で 1、10倍違えば 0）
    const priceNear = item.price > 0 && it.price > 0 ? Math.max(0, 1 - Math.abs(Math.log10(it.price / item.price))) : 0;
    scored.push({ item: it, score: (sameCat ? 3 : 0) + 4 * sim + 0.5 * priceNear, reason, category: cat });
  }
  return scored.sort(byScore).slice(0, limit).map((s) => ({ item: s.item, reason: s.reason }));
}

// detailRecs は詳細ページ下の「あなたへのおすすめ」帯。まずこの商品に近い出品（similarTo）を並べ、
// 足りない分を通常のおすすめ（recommend）で埋める（どちらも実在の出品だけ。同じ商品は2回出さない）。
export const SIMILAR: RecReason = { kind: "similar", text: "この商品に近い" };
export function detailRecs(item: Item, input: RecInput, limit: number): Rec[] {
  if (limit <= 0) return [];
  const near = similarTo(item, input, limit).map((r) => ({ item: r.item, reason: SIMILAR }));
  if (near.length >= limit) return near;
  const rest = recommend({ ...input, excludeIds: [...(input.excludeIds ?? []), item.id, ...near.map((r) => r.item.id)] }, limit - near.length);
  return [...near, ...rest];
}

// ---- 最近見た商品のタイトル（この端末だけ。保存できなくてもおすすめは動く） ----
export const SEEN_TITLES_KEY = "rec-seen-titles";
export const SEEN_TITLES_MAX = 20;

export function loadSeenTitles(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_TITLES_KEY);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, SEEN_TITLES_MAX);
  } catch {
    return [];
  }
}

// rememberSeen は詳細を開いたときに呼ぶ。新しい順に先頭へ入れ、同じタイトルは1つにまとめる。
export function rememberSeen(title: string): void {
  const t = title.trim();
  if (!t) return;
  try {
    const next = [t, ...loadSeenTitles().filter((x) => x !== t)].slice(0, SEEN_TITLES_MAX);
    localStorage.setItem(SEEN_TITLES_KEY, JSON.stringify(next));
  } catch {
    // 保存できない環境（プライベートモードなど）では、「前に見た商品に近い」が出ないだけ
  }
}
