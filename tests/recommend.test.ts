// おすすめの決まり（src/recommend.ts）の単体テスト。画面も通信も使わない。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Figure, FigurePart, Item } from "../src/api.ts";
import type { GardenEntry } from "../src/garden.ts";
import {
  SEEN_TITLES_KEY,
  categoryOf,
  detailRecs,
  colorFamily,
  figureColors,
  loadSeenTitles,
  nearQuery,
  recommend,
  rememberSeen,
  similarTo,
  titleSimilarity,
  type Rec,
  type RecInput,
} from "../src/recommend.ts";

// ---- 見本を作る道具 ----

const NOW = new Date("2026-11-15T12:00:00Z");
const OLD = "2026-10-01T00:00:00Z"; // 新着ではない
const FRESH = "2026-11-14T12:00:00Z"; // 1日前＝新着

const fig = (color: string, shape: FigurePart["shape"] = "box"): Figure => ({
  name: "",
  caption: "",
  parts: [{ shape, size: [1, 1, 1], pos: [0, 0, 0], color }],
});

const mk = (id: string, o: Partial<Item> = {}): Item => ({
  id,
  title: `商品${id}`,
  description: "",
  price: 1000,
  status: "on_sale",
  seller: { id: `s-${id}`, display_name: "出品者" },
  photo_image_id: "",
  figure_image_id: "",
  figure_caption: "",
  figure: null,
  created_at: OLD,
  like_count: 0,
  liked: false,
  moderation_status: "ok",
  moderation_reason: "",
  ...o,
});

const entry = (id: string, title: string, figure: Figure): GardenEntry => ({ id, title, figure, tag: "bought", price: 1000, at: OLD });

const input = (o: Partial<RecInput>): RecInput => ({ items: [], garden: [], purchases: [], seenTitles: [], now: NOW, ...o });

const ids = (recs: Rec[]) => recs.map((r) => r.item.id);

// ---- 除外 ----

test("除外：売り切れ・自分の出品・非公開・見本データ・指定した商品は、どの場合も出ない", () => {
  const cases: [string, Item, Partial<RecInput>][] = [
    ["売り切れ", mk("x", { status: "sold" }), {}],
    ["自分の出品", mk("x", { seller: { id: "me", display_name: "自分" } }), { viewerId: "me" }],
    ["非公開（hidden）", mk("x", { moderation_status: "hidden" }), {}],
    ["見本データ（出品者なし）", mk("x", { seller: null }), {}],
    ["excludeIds", mk("x"), { excludeIds: ["x"] }],
  ];
  const histories: [string, Partial<RecInput>][] = [
    ["履歴なし", {}],
    ["履歴あり", { seenTitles: ["商品x"], garden: [entry("g", "赤い箱", fig("#e8473b"))] }],
  ];
  for (const [why, bad, extra] of cases) {
    for (const [hname, hist] of histories) {
      const got = recommend(input({ items: [bad, mk("ok")], ...hist, ...extra }), 4);
      assert.deepEqual(ids(got), ["ok"], `${why}／${hname}`);
      const sim = similarTo(mk("base", { title: "商品x" }), input({ items: [bad, mk("ok")], ...hist, ...extra }), 3);
      assert.ok(!ids(sim).includes("x"), `類似商品でも ${why}／${hname}`);
    }
  }
});

test("確認中（review）の商品は買えるので出る。未ログイン（viewerId なし）でも出る", () => {
  const got = recommend(input({ items: [mk("r", { moderation_status: "review" })] }), 4);
  assert.deepEqual(ids(got), ["r"]);
});

test("同じ商品が一覧に2回あっても1回だけ", () => {
  assert.deepEqual(ids(recommend(input({ items: [mk("a"), mk("a")] }), 4)), ["a"]);
});

// ---- 多様性 ----

test("多様性：同じカテゴリは limit の半分まで（カテゴリ不明は数えない）", () => {
  const books = Array.from({ length: 6 }, (_, i) => mk(`b${i}`, { title: `文庫${i}`, figure: fig("#3a8fe8"), created_at: FRESH }));
  const others = [mk("o1", { title: "傘" }), mk("o2", { title: "スニーカー" }), mk("o3", { title: "鍵" })];
  const cases: [number, number][] = [
    [4, 2],
    [5, 2],
    [6, 3],
    [2, 1],
    [1, 1],
  ];
  for (const [limit, cap] of cases) {
    const got = recommend(input({ items: [...books, ...others] }), limit);
    const nBooks = got.filter((r) => r.item.id.startsWith("b")).length;
    assert.ok(nBooks <= cap, `limit ${limit} で本が ${nBooks} 件（上限 ${cap}）`);
    assert.ok(got.length <= limit);
  }
  // 上限を超える分は数合わせで入れない（本6＋その他3、limit 8 → 本4＋その他3＝7件）
  assert.equal(recommend(input({ items: [...books, ...others] }), 8).length, 7);
});

// ---- 理由の種類ごと ----

test("理由：いちばん効いた理由が1つだけ付き、文言は仕様どおり", () => {
  const redGarden = [entry("g1", "赤い置物", fig("#e8473b"))]; // 模型1個 → 次のレベルまであと2個
  const cases: [string, Partial<RecInput>, Item, string, string][] = [
    ["箱庭にない色", { garden: redGarden }, mk("x", { title: "置き時計", figure: fig("#3a8fe8"), price: 9000 }), "color", "箱庭にない色"],
    [
      "あと{toNext}個で進化",
      { garden: redGarden },
      mk("x", { title: "置き時計", figure: fig("#e8473b"), price: 500 }),
      "level",
      "あと2個で進化",
    ],
    [
      "{カテゴリ}集め中",
      { purchases: [mk("p", { title: "文庫本 小説", price: 300, status: "sold" })] },
      mk("x", { title: "推理小説 文庫", price: 900 }),
      "category",
      "本集め中",
    ],
    ["前に見た商品に近い", { seenTitles: ["木製チェア ナチュラル"] }, mk("x", { title: "木製チェア 北欧風" }), "seen", "前に見た商品に近い"],
    ["予算内", { purchases: [mk("p", { title: "ギター", price: 2000, status: "sold" })] }, mk("x", { title: "傘", price: 800 }), "budget", "予算内"],
    ["新着", { seenTitles: ["まったく別のもの"] }, mk("x", { title: "傘", created_at: FRESH }), "new", "新着"],
    ["当たる理由が無い", { seenTitles: ["まったく別のもの"] }, mk("x", { title: "傘" }), "starter", "まずはここから"],
    // 見たその商品（タイトルが同じ）は「前に見た商品に近い」にしない
    ["見た商品そのもの", { seenTitles: ["木製チェア 北欧風"] }, mk("x", { title: "木製チェア 北欧風" }), "starter", "まずはここから"],
  ];
  for (const [why, hist, item, kind, text] of cases) {
    const got = recommend(input({ items: [item], ...hist }), 4);
    assert.equal(got.length, 1, why);
    assert.deepEqual(got[0].reason, { kind, text }, why);
  }
});

test("「あと{toNext}個で進化」は gardenLevel の残りを使い、遠いとき・最高レベルでは出ない", () => {
  const garden = (n: number) => Array.from({ length: n }, (_, i) => entry(`g${i}`, "赤い置物", fig("#e8473b")));
  const cheap = mk("x", { title: "置き時計", figure: fig("#e8473b"), price: 100 });
  const cases: [number, string | null][] = [
    [0, null], // 箱庭が空（ほかの履歴が無ければ「まずはここから」）
    [1, "あと2個で進化"],
    [2, "あと1個で進化"],
    [3, null], // 次（6個）まであと3個は遠い
    [5, "あと1個で進化"],
    [15, null], // 最高レベル
  ];
  for (const [n, want] of cases) {
    const got = recommend(input({ items: [cheap, mk("y", { price: 5000 })], garden: garden(n) }), 4);
    const r = got.find((g) => g.item.id === "x")!;
    if (want) assert.deepEqual(r.reason, { kind: "level", text: want }, `模型 ${n} 個`);
    else assert.notEqual(r.reason.kind, "level", `模型 ${n} 個`);
  }
});

test("「予算内」は購入履歴の価格の中央値以下だけ", () => {
  const purchases = [300, 1000, 5000].map((p, i) => mk(`p${i}`, { title: "ギター", price: p, status: "sold" })); // 中央値 1000
  const cases: [number, boolean][] = [
    [999, true],
    [1000, true],
    [1001, false],
  ];
  for (const [price, want] of cases) {
    const got = recommend(input({ items: [mk("x", { title: "傘", price })], purchases }), 4);
    assert.equal(got[0].reason.kind === "budget", want, `¥${price}`);
  }
});

test("白・灰・黒は「箱庭にない色」にしない。文字の札（label）の色も数えない", () => {
  const garden = [entry("g", "赤い置物", fig("#e8473b"))];
  const cases: [string, Figure][] = [
    ["白", fig("#ffffff")],
    ["灰", fig("#8a8f98")],
    ["黒", fig("#111111")],
    ["札だけ青", { name: "", caption: "", parts: [{ shape: "box", size: [1, 1, 1], pos: [0, 0, 0], color: "#e8473b" }, { shape: "label", size: [1, 1], pos: [0, 0, 0], color: "#3a8fe8" }] }],
  ];
  for (const [why, f] of cases) {
    const got = recommend(input({ items: [mk("x", { title: "置き時計", figure: f, price: 9000 }), mk("y", { price: 100 })], garden }), 4);
    assert.notEqual(got.find((r) => r.item.id === "x")!.reason.kind, "color", why);
  }
});

test("急がせる文言・偽の残り個数は作らない（理由の文言はすべて決まった形）", () => {
  const allowed = /^(箱庭にない色|あと\d+個で進化|.+集め中|前に見た商品に近い|予算内|新着|まずはここから)$/;
  const items = Array.from({ length: 12 }, (_, i) =>
    mk(`i${i}`, { title: ["文庫", "ランプ", "スニーカー", "マグ"][i % 4] + i, price: 300 * (i + 1), figure: fig(["#3a8fe8", "#e8473b", "#2e9e4f"][i % 3]), created_at: i % 2 ? FRESH : OLD }),
  );
  const hist: Partial<RecInput>[] = [
    {},
    { garden: [entry("g", "ランプ", fig("#e8473b"))], purchases: [mk("p", { title: "文庫", price: 1500, status: "sold" })], seenTitles: ["スニーカー白"] },
  ];
  for (const h of hist) {
    for (const r of recommend(input({ items, ...h }), 8)) {
      assert.match(r.reason.text, allowed);
      assert.doesNotMatch(r.reason.text, /残り|今だけ|急いで|まもなく|限定/);
    }
  }
});

// ---- 履歴なし ----

test("履歴なし：全部「まずはここから」で、新着＋模型あり＋低価格が上", () => {
  const items = [
    mk("plain", { title: "傘", price: 3000 }),
    mk("best", { title: "鍵", price: 500, figure: fig("#3a8fe8"), created_at: FRESH }),
    mk("fig", { title: "鈴", price: 3000, figure: fig("#3a8fe8") }),
    mk("pricey", { title: "壺", price: 99999, figure: fig("#3a8fe8"), created_at: FRESH }),
  ];
  const got = recommend(input({ items }), 4);
  assert.equal(got[0].item.id, "best");
  assert.ok(got.every((r) => r.reason.kind === "starter" && r.reason.text === "まずはここから"));
  assert.ok(ids(got).indexOf("fig") < ids(got).indexOf("plain"));
});

test("検索0件のフォールバック：検索語に近い商品が上に来る", () => {
  const items = [mk("a", { title: "傘", created_at: FRESH, figure: fig("#3a8fe8") }), mk("b", { title: "古い腕時計", description: "電池交換済み" })];
  assert.equal(recommend(input({ items, query: "腕時計" }), 2)[0].item.id, "b");
  assert.equal(recommend(input({ items }), 2)[0].item.id, "a");
});

// ---- 同点の順・決定的 ----

test("同点は新しい順 → id の順", () => {
  const items = [
    mk("b", { created_at: "2026-10-02T00:00:00Z" }),
    mk("c", { created_at: "2026-10-03T00:00:00Z" }),
    mk("a", { created_at: "2026-10-02T00:00:00Z" }),
  ];
  assert.deepEqual(ids(recommend(input({ items }), 3)), ["c", "a", "b"]);
});

test("決定的：一覧の並びを入れ替えても同じ結果", () => {
  const items = Array.from({ length: 10 }, (_, i) =>
    mk(`i${i}`, { title: ["文庫", "ランプ", "スニーカー", "マグ", "傘"][i % 5], price: 500 + (i % 3) * 400, figure: i % 2 ? fig("#3a8fe8") : null }),
  );
  const h = { garden: [entry("g", "ランプ", fig("#e8473b"))], seenTitles: ["スニーカー"] };
  const a = recommend(input({ items, ...h }), 6);
  const b = recommend(input({ items: [...items].reverse(), ...h }), 6);
  assert.deepEqual(a, b);
});

// ---- limit ----

test("limit：0 以下は空、候補より多ければ全部、少なければ切る", () => {
  const items = [mk("a"), mk("b"), mk("c")];
  const cases: [number, number][] = [
    [0, 0],
    [-1, 0],
    [2, 2],
    [3, 3],
    [10, 3],
  ];
  for (const [limit, n] of cases) {
    assert.equal(recommend(input({ items }), limit).length, n, `recommend limit ${limit}`);
    assert.equal(similarTo(mk("base", { title: "商品" }), input({ items }), limit).length, n, `similarTo limit ${limit}`);
  }
});

// ---- 類似商品 ----

test("similarTo：同じカテゴリ・近いタイトルが上、自分自身と似ていない物は出ない", () => {
  const base = mk("base", { title: "デスクライト LED", price: 800 });
  const items = [
    base,
    mk("lamp", { title: "テーブルランプ", price: 1200 }), // 同じ照明
    mk("near", { title: "デスクライト 白", price: 900 }), // 照明＋タイトルが近い
    mk("chair", { title: "木製チェア", price: 800 }), // 似ていない
    mk("soldlamp", { title: "デスクライト 黒", status: "sold" }),
  ];
  const got = similarTo(base, input({ items }), 3);
  assert.deepEqual(ids(got), ["near", "lamp"]);
  assert.ok(got.every((r) => r.reason.kind === "seen"));
});

test("similarTo：一覧に無い商品を基準にしても、同じ id は出さない", () => {
  const base = mk("base", { title: "文庫 小説" });
  const got = similarTo(base, input({ items: [mk("base", { title: "文庫 小説" }), mk("x", { title: "文庫 エッセイ" })] }), 3);
  assert.deepEqual(ids(got), ["x"]);
});

// ---- 部品：カテゴリ・色・タイトルの近さ ----

test("categoryOf：語の辞書で推定する（後ろに出てくる語を優先）", () => {
  const cases: [string, string, string | null][] = [
    ["青い文庫本", "", "本"],
    ["デスクライト", "", "照明"],
    ["テーブルランプ", "", "照明"], // 後ろの語が中心
    ["推理小説 文庫", "", "本"],
    ["木製チェア", "", "家具"],
    ["白スニーカー", "", "靴"],
    ["マグカップ", "", "食器"],
    ["ワイヤレスイヤホン", "", "家電"],
    ["ぬいぐるみ", "", "おもちゃ"],
    ["ボールペン 3本", "", "文房具"],
    ["Tシャツ", "", "服"],
    ["本体のみ", "日本製", null], // 「本」1文字では本にしない
    ["まとめ売り", "小説が5冊", "本"], // 説明文からも推定する
    ["", "", null],
  ];
  for (const [title, desc, want] of cases) assert.equal(categoryOf(title, desc), want, `${title}／${desc}`);
});

test("colorFamily：色の系統", () => {
  const cases: [string, string | null][] = [
    ["#e8473b", "赤"],
    ["#3a8fe8", "青"],
    ["#e8833a", "橙"],
    ["#8b5a2b", "茶"],
    ["#f5d33a", "黄"],
    ["#2e9e4f", "緑"],
    ["#8e44ad", "紫"],
    ["#ffb6c1", "桃"],
    ["#fff", "白"],
    ["#8a8f98", "灰"],
    ["#000000", "黒"],
    ["blue", null],
    ["#12345", null],
  ];
  for (const [hex, want] of cases) assert.equal(colorFamily(hex), want, hex);
});

test("figureColors：小さな部品の色は主な色に入らない", () => {
  const f: Figure = {
    name: "",
    caption: "",
    parts: [
      { shape: "box", size: [2, 2, 2], pos: [0, 0, 0], color: "#3a8fe8" },
      { shape: "sphere", size: [0.2], pos: [0, 0, 0], color: "#e8473b" },
    ],
  };
  assert.deepEqual([...figureColors(f)], ["青"]);
  assert.deepEqual([...figureColors(null)], []);
});

test("titleSimilarity：同じなら 1、共通の字が無ければ 0、ひらがなだけの重なりは数えない", () => {
  assert.equal(titleSimilarity("木製チェア", "木製チェア"), 1);
  assert.equal(titleSimilarity("傘", "鍵"), 0);
  assert.equal(titleSimilarity("あたらしいです", "ふるいです"), 0);
  assert.ok(titleSimilarity("木製チェア 北欧", "木製チェア 白") > 0.5);
});

// ---- 最近見た商品（localStorage） ----

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
}

let store: MemoryStorage;
const setStorage = (s: unknown) => Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });

beforeEach(() => {
  store = new MemoryStorage();
  setStorage(store);
});

test("loadSeenTitles：壊れた値は [] か、文字列だけ残す", () => {
  const cases: [string | null, string[]][] = [
    [null, []],
    ["{壊れた", []],
    ["null", []],
    ['"文字列"', []],
    [JSON.stringify({ a: 1 }), []],
    [JSON.stringify(["傘", 1, null, "", "  ", "鍵"]), ["傘", "鍵"]],
    [JSON.stringify(Array.from({ length: 30 }, (_, i) => `t${i}`)), Array.from({ length: 20 }, (_, i) => `t${i}`)],
  ];
  for (const [raw, want] of cases) {
    store = new MemoryStorage();
    if (raw !== null) store.setItem(SEEN_TITLES_KEY, raw);
    setStorage(store);
    assert.deepEqual(loadSeenTitles(), want, String(raw));
  }
});

test("rememberSeen：新しい順に先頭へ、同じタイトルは1つ、最大20件、空は覚えない", () => {
  rememberSeen("傘");
  rememberSeen("鍵");
  rememberSeen("傘");
  rememberSeen("   ");
  assert.deepEqual(loadSeenTitles(), ["傘", "鍵"]);
  for (let i = 0; i < 25; i++) rememberSeen(`t${i}`);
  const got = loadSeenTitles();
  assert.equal(got.length, 20);
  assert.equal(got[0], "t24");
});

test("localStorage が使えない環境でも例外を出さない", () => {
  setStorage({
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  });
  assert.doesNotThrow(() => rememberSeen("傘"));
  assert.deepEqual(loadSeenTitles(), []);
});

// ---- 詳細ページのおすすめ帯 ----

test("detailRecs：この商品に近い物が先（理由は「この商品に近い」）、足りない分は通常のおすすめで埋める。同じ商品・今の商品は出さない", () => {
  const base = mk("base", { title: "デスクライト" });
  const items = [base, mk("lamp2", { title: "デスクライト 白" }), mk("mug", { title: "マグカップ", created_at: FRESH }), mk("book", { title: "文庫本" })];
  const got = detailRecs(base, input({ items }), 3);
  assert.equal(got[0].item.id, "lamp2");
  assert.deepEqual(got[0].reason, { kind: "similar", text: "この商品に近い" });
  assert.equal(got.length, 3);
  assert.ok(!ids(got).includes("base"));
  assert.equal(new Set(ids(got)).size, got.length);
  for (const r of got.slice(1)) assert.notEqual(r.reason.kind, "similar");
});

test("detailRecs：似た物が limit 件あれば埋めない。limit 0 は空。ほかに出品が無ければ数合わせしない", () => {
  const base = mk("base", { title: "デスクライト" });
  const lamps = ["a", "b", "c"].map((id) => mk(id, { title: `デスクライト ${id}` }));
  assert.deepEqual(ids(detailRecs(base, input({ items: [...lamps, mk("z", { title: "マグ" })] }), 3)).sort(), ["a", "b", "c"]);
  assert.deepEqual(detailRecs(base, input({ items: lamps }), 0), []);
  assert.deepEqual(detailRecs(base, input({ items: [base] }), 3), []);
  // 売り切れは埋める側でも出ない
  assert.deepEqual(ids(detailRecs(base, input({ items: [mk("s", { status: "sold" })] }), 3)), []);
});

test("nearQuery：検索語と名前・説明が語を共有するときだけ true（空の語・関係ない物は false）", () => {
  assert.equal(nearQuery("デスクライト", mk("a", { title: "LEDデスクライト" })), true);
  assert.equal(nearQuery("ライト", mk("b", { title: "照明", description: "白いライトです" })), true);
  assert.equal(nearQuery("ゲーム機", mk("c", { title: "赤いマグカップ" })), false);
  assert.equal(nearQuery("   ", mk("d", { title: "赤いマグカップ" })), false);
});
