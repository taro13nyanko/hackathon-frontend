// 出品フォームの価格（src/sell.ts）の単体テスト。画面は使わない部分だけを確かめる。
// 実行：npm test（Node 24 の node:test）
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePriceInput, parsePrice, priceError } from "../src/sell.ts";

test("parsePrice：打った文字をそのまま整数にする（500 は 500、800 は 800。丸めない・ずらさない）", () => {
  for (const n of [300, 497, 500, 797, 800, 1200, 1203, 1500, 9999999]) assert.equal(parsePrice(String(n)), n);
});

test("parsePrice：全角数字・カンマ・¥・円・空白を受ける", () => {
  assert.equal(parsePrice("５００"), 500);
  assert.equal(parsePrice("1,500"), 1500);
  assert.equal(parsePrice("１，５００"), 1500);
  assert.equal(parsePrice("¥800"), 800);
  assert.equal(parsePrice("￥８００"), 800);
  assert.equal(parsePrice("800円"), 800);
  assert.equal(parsePrice(" 800 "), 800);
});

test("parsePrice：数字だけでなければ null（読める所だけ拾わない）", () => {
  for (const t of ["", " ", "12.5", "-300", "1e3", "abc", "500a", "0x10"]) assert.equal(parsePrice(t), null, t);
});

test("normalizePriceInput：入力中の文字をそろえる（数字以外の誤りは残して、送るときに知らせる）", () => {
  assert.equal(normalizePriceInput("１，５００円"), "1500");
  assert.equal(normalizePriceInput("12.5"), "12.5");
  assert.equal(normalizePriceInput(""), "");
});

test("priceError：範囲外・整数でないときだけ文を返す", () => {
  assert.equal(priceError("300", 300, 9999999), "");
  assert.equal(priceError("9,999,999", 300, 9999999), "");
  assert.match(priceError("299", 300, 9999999), /¥300〜¥9,999,999 の整数/);
  assert.match(priceError("10000000", 300, 9999999), /整数/);
  assert.match(priceError("12.5", 300, 9999999), /整数/);
  assert.match(priceError("", 300, 9999999), /整数/);
});
