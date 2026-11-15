// ホーム（A-1）と下部タブの決まり（src/home.ts）の単体テスト。画面は使わない部分だけを確かめる。
// 実行：npm test（Node 24 の node:test）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_PROMPT,
  REC_SUB,
  REC_SUB_STARTER,
  TABS,
  buildGarden,
  collectionText,
  confirmChipText,
  countAfterBuy,
  detailRecSub,
  figureRows,
  gardenChipText,
  levelChipText,
  levelPercent,
  recSubText,
  tabOf,
} from "../src/home.ts";
import { gardenLevel } from "../src/garden.ts";
import type { Figure, Item, Purchase } from "../src/api.ts";
import type { GardenEntry } from "../src/garden.ts";

const fig: Figure = { name: "模型", caption: "", parts: [] };
const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  title: `商品${id}`,
  description: "",
  price: 1000,
  status: "on_sale",
  seller: { id: "me", display_name: "わたし" },
  photo_image_id: "",
  figure_image_id: "",
  figure_caption: "",
  figure: null,
  created_at: "2026-11-01T00:00:00Z",
  like_count: 0,
  liked: false,
  moderation_status: "ok",
  moderation_reason: "",
  ...over,
});
const purchase = (it: Item, at: string, price = it.price): Purchase => ({ id: `p-${it.id}`, item: it, price, created_at: at });

// ---- 箱庭の中身 ----

test("出品・購入から箱庭を作る：模型のある物だけ並び、タグは 売った／出品中／買った", () => {
  const mine = [
    item("a", { figure: fig, status: "sold", created_at: "2026-11-01T00:00:00Z" }),
    item("b", { figure: fig, created_at: "2026-11-03T00:00:00Z" }),
    item("c", { created_at: "2026-11-02T00:00:00Z" }), // 模型なし
  ];
  const bought = [purchase(item("d", { figure: fig, seller: { id: "x", display_name: "x" } }), "2026-11-02T00:00:00Z", 500)];
  const g = buildGarden(mine, bought, [], null);
  assert.deepEqual(
    g.entries.map((e) => [e.id, e.tag]),
    [
      ["a", "sold"],
      ["d", "bought"],
      ["b", "selling"],
    ],
    "古い順",
  );
  assert.deepEqual(g.missing.map((it) => it.id), ["c"]);
  assert.equal(g.entries.find((e) => e.id === "d")?.price, 500, "購入は買った値段");
  assert.deepEqual(g.purchases.map((it) => it.id), ["d"]);
  assert.equal(g.items.c.title, "商品c", "模型がまだの物もサムネ用に引ける");
});

test("初めて開いたとき（seen が null）は NEW にしない。2回目からは増えた分だけ NEW", () => {
  const mine = [item("a", { figure: fig }), item("b", { figure: fig })];
  assert.equal(buildGarden(mine, [], [], null).entries.filter((e) => e.isNew).length, 0);
  const again = buildGarden(mine, [], [], new Set(["a"]));
  assert.deepEqual(again.entries.filter((e) => e.isNew).map((e) => e.id), ["b"]);
});

test("動かした置き場所が付き、同じ商品が出品と購入の両方にあっても1つだけ並ぶ", () => {
  const a = item("a", { figure: fig, created_at: "2026-11-01T00:00:00Z" });
  const g = buildGarden([a], [purchase(a, "2026-11-05T00:00:00Z")], [{ item_id: "a", x: 1.5, z: -2 }], null);
  assert.equal(g.entries.length, 1);
  assert.equal(g.entries[0].tag, "selling", "先に出てきた（古い）方を使う");
  assert.deepEqual(g.entries[0].spot, { x: 1.5, z: -2 });
});

// ---- レベルカード ----

test("％はバーと同じ数（progress を丸めたもの）で、0〜100 に収まる", () => {
  assert.equal(levelPercent(gardenLevel(0).progress), 0);
  assert.equal(levelPercent(gardenLevel(8).progress), 50);
  assert.equal(levelPercent(gardenLevel(4).progress), 33);
  assert.equal(levelPercent(gardenLevel(999).progress), 100, "最高レベルは 100%");
  assert.equal(levelPercent(1.7), 100);
  assert.equal(levelPercent(-1), 0);
  assert.equal(levelPercent(NaN), 0);
});

test("箱庭カードのチップは模型の総数（図鑑の母数は付けない）", () => {
  assert.equal(collectionText(4), "Geminiがフィギュア化 ・ 4体コレクション済み");
  assert.doesNotMatch(collectionText(4), /\//);
});

test("フィギュア一覧は NEW が上、その中は新しい順。元の並びは変えない", () => {
  const e = (id: string, at: string, isNew = false): GardenEntry => ({ id, title: id, figure: fig, tag: "bought", price: 1, at, isNew });
  const src = [e("old", "2026-11-01"), e("newest", "2026-11-09"), e("fresh", "2026-11-02", true), e("mid", "2026-11-05")];
  assert.deepEqual(figureRows(src).map((x) => x.id), ["fresh", "newest", "mid", "old"]);
  assert.deepEqual(src.map((x) => x.id), ["old", "newest", "fresh", "mid"]);
});

// ---- 下部タブ ----

test("タブは5つで、出品が真ん中", () => {
  assert.deepEqual(TABS.map((t) => t.label), ["ホーム", "さがす", "出品", "メッセージ", "マイページ"]);
  assert.equal(TABS[2].key, "sell");
});

test("今の画面がどのタブか（詳細・購入などはどれでもない）", () => {
  assert.equal(tabOf("list"), "home");
  assert.equal(tabOf("garden"), "home");
  assert.equal(tabOf("search"), "search");
  assert.equal(tabOf("sell"), "sell");
  assert.equal(tabOf("inbox"), "messages");
  assert.equal(tabOf("chat"), "messages");
  assert.equal(tabOf("mypage"), "mypage");
  for (const v of ["detail", "confirm", "bought", "admin"]) assert.equal(tabOf(v), null, v);
});

test("ログインが要るのは 出品・メッセージ・マイページ だけで、それぞれ案内がある", () => {
  const need = TABS.filter((t) => t.needsLogin).map((t) => t.key);
  assert.deepEqual(need, ["sell", "messages", "mypage"]);
  for (const k of need) assert.ok(LOGIN_PROMPT[k as keyof typeof LOGIN_PROMPT].includes("ログイン"));
});

// ---- 「買うと箱庭に増える」 ----

test("模型・写真の有無でチップの文言が変わり、どちらも無ければ出さない", () => {
  assert.equal(gardenChipText({ figure: fig, photo_image_id: "" }), "買うと箱庭に増える（模型つき）");
  assert.equal(gardenChipText({ figure: null, photo_image_id: "p1" }), "買うと箱庭に増える（写真から模型をつくれます）");
  assert.equal(gardenChipText({ figure: null, photo_image_id: "" }), "");
});

test("おすすめの補足：全部「まずはここから」のときだけ、箱庭・購入履歴の話をしない", () => {
  const cases: [string[], string][] = [
    [["starter", "starter"], REC_SUB_STARTER],
    [["starter", "color"], REC_SUB],
    [["new"], REC_SUB],
    [[], REC_SUB], // 0件（「いまおすすめできる出品はありません」と一緒に出る）
  ];
  for (const [kinds, want] of cases) assert.equal(recSubText(kinds), want, kinds.join(","));
});

// ---- 買う流れ ----

test("あと{toNext}個で進化：次のレベルがあるときだけ。いちばん大きな島では出さない", () => {
  assert.equal(levelChipText(gardenLevel(6)), "あと4個で進化"); // にぎやかな広場（6）→ ちいさな町（10）
  assert.equal(levelChipText(gardenLevel(0)), "あと3個で進化");
  assert.equal(levelChipText(gardenLevel(15)), "");
  assert.equal(levelChipText(gardenLevel(99)), "");
});

test("購入確認のチップ：模型つき／写真だけ／どちらも無い（出さない）", () => {
  assert.equal(confirmChipText({ figure: fig, photo_image_id: "" }), "買うと箱庭に増えます");
  assert.match(confirmChipText({ figure: null, photo_image_id: "p" }), /写真から模型/);
  assert.equal(confirmChipText({ figure: null, photo_image_id: "" }), "");
});

test("購入後の模型の数：模型つきは1つ増える。読み直しの前でも後でも同じ数。模型の無い物は増えない", () => {
  const before = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(countAfterBuy(before, { id: "x", figure: fig }), 4); // 読み直し前
  assert.equal(countAfterBuy([...before, { id: "x" }], { id: "x", figure: fig }), 4); // 読み直し後
  assert.equal(countAfterBuy(before, { id: "x", figure: null }), 3);
  // 見本の流れ：Lv.3 で「あと4個」→ 買ったあとは「あと3個」
  assert.equal(gardenLevel(6).toNext, 4);
  assert.equal(gardenLevel(countAfterBuy(new Array(6).fill(0).map((_, i) => ({ id: `e${i}` })), { id: "x", figure: fig })).toNext, 3);
});

test("詳細のおすすめ帯の補足：使った理由だけを書く", () => {
  assert.equal(detailRecSub(["similar", "similar"]), "この商品に近い、いま買える実在の出品");
  assert.equal(detailRecSub(["similar", "color"]), "この商品に近い物と、箱庭・購入履歴から選んだ実在の出品");
  assert.equal(detailRecSub(["similar", "starter"]), "この商品に近い物と、新着・模型つき・手ごろな実在の出品");
  assert.equal(detailRecSub(["starter", "starter"]), REC_SUB_STARTER);
  assert.equal(detailRecSub(["budget"]), REC_SUB);
});
