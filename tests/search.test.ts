// 一覧の検索条件（src/search.ts）の単体テスト。価格の札の文字と、GET /items の ? 以降。
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RANGE, itemsQuery, priceRangeLabel } from "../src/search.ts";

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
