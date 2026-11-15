// 出品の確認の表示（src/moderation.ts）の単体テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_TEXT, categoryLabels, moderationNote } from "../src/moderation.ts";

test("カテゴリは仕様の10種類がすべて日本語名を持つ", () => {
  assert.deepEqual(Object.keys(CATEGORY_TEXT).sort(), [
    "adult",
    "counterfeit",
    "drug",
    "hazardous",
    "living",
    "money",
    "other",
    "personal_info",
    "violence",
    "weapon",
  ]);
});

test("カテゴリを日本語名に直す。知らない名前は「その他」、重なりは1回", () => {
  assert.deepEqual(categoryLabels(["weapon", "drug"]), ["武器・刃物・模造銃", "薬物・医薬品・たばこ・酒"]);
  assert.deepEqual(categoryLabels(["xxx", "other", "weapon"]), ["その他", "武器・刃物・模造銃"]);
  assert.deepEqual(categoryLabels([]), []);
});

test("確認中：理由が届く人（出品者・管理者）には理由つき、ほかの人には定型文", () => {
  assert.deepEqual(moderationNote("review", "写真と商品名が違います"), { kind: "review", text: "確認中：写真と商品名が違います" });
  assert.deepEqual(moderationNote("review", ""), { kind: "review", text: "運営が確認中の商品です" });
});

test("非公開と問題なし", () => {
  assert.equal(moderationNote("hidden", "")?.kind, "hidden");
  assert.match(moderationNote("hidden", "偽ブランド")?.text ?? "", /偽ブランド/);
  assert.equal(moderationNote("ok", "古い理由"), null);
});
