// 一覧の検索条件（src/search.ts）の単体テスト。価格の札の文字と、GET /items の ? 以降。
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RANGE, isFiltered, itemsQuery, nextSearch, priceRangeLabel, type SearchCond } from "../src/search.ts";

test("価格の札：両方・上限だけ・下限だけ・なし", () => {
  assert.equal(priceRangeLabel({ min: 700, max: 1300 }), "¥700 〜 ¥1,300");
  assert.equal(priceRangeLabel({ min: 0, max: 3000 }), "〜 ¥3,000");
  assert.equal(priceRangeLabel({ min: 5000, max: 0 }), "¥5,000 〜");
  assert.equal(priceRangeLabel(NO_RANGE), "");
});

test("検索の条件：空のキーワードと 0 の価格は付けない", () => {
  assert.equal(itemsQuery(""), "");
  assert.equal(itemsQuery("   ", NO_RANGE), "");
  assert.equal(itemsQuery(" 電卓 "), "?q=%E9%9B%BB%E5%8D%93");
  assert.equal(itemsQuery("", { min: 0, max: 3000 }), "?max_price=3000");
  assert.equal(itemsQuery("本", { min: 700, max: 1300 }), "?q=%E6%9C%AC&min_price=700&max_price=1300");
});

test("検索語の記号はエスケープされる（& や = で条件が増えない）", () => {
  const p = new URLSearchParams(itemsQuery("a&min_price=1").slice(1));
  assert.equal(p.get("q"), "a&min_price=1");
  assert.equal(p.get("min_price"), null);
});

// ---- 次の検索の条件（2026-11 再テスト：本とランプが一覧から消えて見えた件） ----

const voiced: SearchCond = { q: "電卓", range: { min: 1000, max: 0 }, heard: "1000円以上の電卓" };

test("手で打った検索は、音声で付いた価格の範囲を引き継がない", () => {
  assert.deepEqual(nextSearch(voiced, { source: "header", q: "" }), { q: "", range: NO_RANGE, heard: "" });
  assert.deepEqual(nextSearch(voiced, { source: "header", q: "本" }), { q: "本", range: NO_RANGE, heard: "" });
});

test("音声検索の結果は、その範囲をそのまま使う", () => {
  const r = { min: 0, max: 3000 };
  assert.deepEqual(nextSearch({ q: "", range: NO_RANGE, heard: "" }, { source: "voice", q: "電卓", range: r, heard: "3000円以下の電卓" }), {
    q: "電卓",
    range: r,
    heard: "3000円以下の電卓",
  });
});

test("下部タブ「さがす」・「すべての商品を見る」は条件なしの全件。札の × は範囲だけ外す", () => {
  for (const source of ["tab", "all"] as const) {
    const got = nextSearch(voiced, { source });
    assert.deepEqual(got, { q: "", range: NO_RANGE, heard: "" }, source);
    assert.equal(isFiltered(got), false);
  }
  assert.deepEqual(nextSearch(voiced, { source: "clearRange" }), { q: "電卓", range: NO_RANGE, heard: "" });
  assert.equal(isFiltered(voiced), true);
  assert.equal(isFiltered({ q: "  ", range: NO_RANGE }), false);
  assert.equal(isFiltered({ q: "", range: { min: 0, max: 500 } }), true);
});

test("本番と同じ8件の価格：音声で下限1000円が付いたあと、ヘッダーから空で検索すると全件（497円・797円も）を取りに行く", () => {
  const prices = [497, 797, 1200, 1203, 2000, 3000, 4000, 4500];
  const after = nextSearch(voiced, { source: "header", q: "" });
  assert.equal(itemsQuery(after.q, after.range), "", "条件なし＝全件");
  const inRange = (p: number) => (after.range.min === 0 || p >= after.range.min) && (after.range.max === 0 || p <= after.range.max);
  assert.deepEqual(prices.filter(inRange), prices);
  // 直す前の動き（範囲を引き継ぐ）なら、本（497）とランプ（797）だけが消えていた
  assert.deepEqual(prices.filter((p) => p >= voiced.range.min), [1200, 1203, 2000, 3000, 4000, 4500]);
});
