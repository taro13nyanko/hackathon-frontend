// API のエラー応答 → 画面に出すエラー（src/apiErrors.ts）の単体テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  ASK_MESSAGES,
  codeOf,
  createItemError,
  LIKE_MESSAGES,
  ProhibitedError,
  prohibitedFrom,
  toApiError,
  VOICE_MESSAGES,
} from "../src/apiErrors.ts";

test("codeOf は本文の error を取り出し、形が違えば空にする", () => {
  assert.equal(codeOf({ error: "too_many" }), "too_many");
  assert.equal(codeOf({ error: 429 }), "");
  assert.equal(codeOf({}), "");
  assert.equal(codeOf(null), "");
  assert.equal(codeOf("too_many"), "");
});

test("出品の 422 は ProhibitedError になり、理由とカテゴリを持つ", () => {
  const e = createItemError(422, { error: "prohibited", reason: "模造刀は出品できません", categories: ["weapon", "other"] });
  assert.ok(e instanceof ProhibitedError);
  assert.ok(e instanceof ApiError);
  const p = e as ProhibitedError;
  assert.equal(p.status, 422);
  assert.equal(p.code, "prohibited");
  assert.equal(p.reason, "模造刀は出品できません");
  assert.deepEqual(p.categories, ["weapon", "other"]);
});

test("422 の本文の形が崩れていても、空の理由とカテゴリに倒す", () => {
  const cases: [unknown, string, string[]][] = [
    [null, "", []],
    [{ reason: 1, categories: "weapon" }, "", []],
    [{ reason: "理由", categories: ["weapon", 3, null, "drug"] }, "理由", ["weapon", "drug"]],
  ];
  for (const [body, reason, categories] of cases) {
    const p = prohibitedFrom(body);
    assert.equal(p.reason, reason);
    assert.deepEqual(p.categories, categories);
  }
});

test("出品のそのほかの失敗は、HTTP 番号ごとの文言とコードになる", () => {
  const cases: [number, string, string][] = [
    [401, "unauthorized", "ログインし直してください"],
    [403, "profile_required", "表示名を登録してから出品してください"],
    [429, "too_many", "出品が続きすぎです。1分ほど待ってから、もう一度お試しください（1分に10件まで）"],
  ];
  for (const [status, code, message] of cases) {
    const e = createItemError(status, { error: code }) as ApiError;
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
  assert.match(createItemError(400, {}).message, /^商品名は1〜40文字、説明は1000文字まで、価格は300〜9,999,999円/);
  assert.equal(createItemError(500, null).message, "出品に失敗しました (HTTP 500)");
});

test("toApiError はエラーコードで文言を引き、無いコードは HTTP 番号つきの既定文にする", () => {
  const cases: [number, string, Record<string, string>, string][] = [
    [404, "not_found", LIKE_MESSAGES, "この商品は見つかりませんでした"],
    [429, "too_many", LIKE_MESSAGES, "いいねが続きすぎです。少し待ってから、もう一度お試しください（1分に60回まで）"],
    [502, "ai_failed", VOICE_MESSAGES, "うまく聞き取れませんでした。もう一度お試しください"],
    [429, "too_many", ASK_MESSAGES, "少し時間をおいてから、もう一度お試しください（1分に5回まで）"],
    [404, "not_found", ASK_MESSAGES, "この商品は見つかりませんでした"],
    [500, "", ASK_MESSAGES, "質問に失敗しました (HTTP 500)"],
    [418, "teapot", LIKE_MESSAGES, "質問に失敗しました (HTTP 418)"],
  ];
  for (const [status, code, messages, want] of cases) {
    const e = toApiError(status, code, messages, "質問に失敗しました");
    assert.equal(e.message, want);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
  }
});
