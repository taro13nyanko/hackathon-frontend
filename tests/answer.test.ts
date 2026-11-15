// 商品への質問の答え（src/answer.ts）の単体テスト。[n] を根拠へのリンクに分ける。
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceKindText, splitAnswer } from "../src/answer.ts";

test("文字と番号に分ける", () => {
  assert.deepEqual(splitAnswer("新品です[1]。受け渡しはメッセージで[3]。", [1, 3]), [
    { kind: "text", text: "新品です" },
    { kind: "ref", id: 1 },
    { kind: "text", text: "。受け渡しはメッセージで" },
    { kind: "ref", id: 3 },
    { kind: "text", text: "。" },
  ]);
});

test("根拠の一覧に無い番号は消し、前後の文字はつなげる", () => {
  assert.deepEqual(splitAnswer("あ[2]い[9]う", [2]), [
    { kind: "text", text: "あ" },
    { kind: "ref", id: 2 },
    { kind: "text", text: "いう" },
  ]);
});

test("番号が無い答え・空の答え", () => {
  assert.deepEqual(splitAnswer("この商品の情報からは分かりません。", []), [{ kind: "text", text: "この商品の情報からは分かりません。" }]);
  assert.deepEqual(splitAnswer("", [1]), []);
});

test("続けて並んだ番号・先頭の番号", () => {
  assert.deepEqual(splitAnswer("[1][2]です", [1, 2]), [
    { kind: "ref", id: 1 },
    { kind: "ref", id: 2 },
    { kind: "text", text: "です" },
  ]);
});

test("数字でない角かっこはそのまま文字として残す", () => {
  assert.deepEqual(splitAnswer("[注]と[a1]", [1]), [{ kind: "text", text: "[注]と[a1]" }]);
});

test("根拠の種類の札", () => {
  assert.equal(sourceKindText("item"), "この商品");
  assert.equal(sourceKindText("rule"), "アプリの決まり");
  assert.equal(sourceKindText("seller_item"), "出品者の他の商品");
  assert.equal(sourceKindText("figure"), "模型");
  assert.equal(sourceKindText("unknown"), "資料");
});
