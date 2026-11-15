// マイページ・メッセージ・ログイン（A-1）の決まり（src/pages.ts）の単体テスト。画面は使わない部分だけを確かめる。
// 実行：npm test（Node 24 の node:test）
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatBuyable, initialOf, myCounts, mySections, previewText, relativeTime } from "../src/pages.ts";
import type { Item, Purchase } from "../src/api.ts";

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  title: `商品${id}`,
  description: "",
  price: 500,
  status: "on_sale",
  seller: { id: "seller", display_name: "たろう" },
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

test("initialOf：表示名の最初の1文字。空白だけなら ?、絵文字は割らない", () => {
  assert.equal(initialOf("たろう"), "た");
  assert.equal(initialOf("  hanako"), "H");
  assert.equal(initialOf("   "), "?");
  assert.equal(initialOf(""), "?");
  assert.equal(initialOf("🐱ねこ"), "🐱");
});

test("relativeTime：たった今・分・時間・日。日付そのものは出さない", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  assert.equal(relativeTime("2026-11-15T11:59:30Z", now), "たった今");
  assert.equal(relativeTime("2026-11-15T12:00:30Z", now), "たった今"); // 端末の時計が遅れていても負にしない
  assert.equal(relativeTime("2026-11-15T11:50:00Z", now), "10分前");
  assert.equal(relativeTime("2026-11-15T09:00:00Z", now), "3時間前");
  assert.equal(relativeTime("2026-11-13T12:00:00Z", now), "2日前");
  assert.equal(relativeTime("2026-09-01T12:00:00Z", now), "1か月以上前");
  assert.equal(relativeTime("壊れた値", now), "");
  for (const s of ["たった今", "10分前", "3時間前", "2日前"]) assert.doesNotMatch(s, /\d+\/\d+/);
});

test("previewText：自分が送った物だけ「あなた: 」、無ければ案内", () => {
  assert.equal(previewText({ sender_id: "me", body: "どうぞ" }, "me"), "あなた: どうぞ");
  assert.equal(previewText({ sender_id: "you", body: "まだありますか？" }, "me"), "まだありますか？");
  assert.equal(previewText(null, "me"), "（まだメッセージはありません）");
  // 自分の ID が分からないとき（読み込み中）は、相手の物として出す（「あなた」と決めつけない）
  assert.equal(previewText({ sender_id: "", body: "x" }, ""), "x");
});

test("chatBuyable：売り切れ・自分の商品・見本データ・非公開には「購入する」を出さない", () => {
  assert.equal(chatBuyable(item("a"), "me"), true);
  assert.equal(chatBuyable(item("a", { status: "sold" }), "me"), false);
  assert.equal(chatBuyable(item("a", { seller: { id: "me", display_name: "私" } }), "me"), false);
  assert.equal(chatBuyable(item("a", { seller: null }), "me"), false);
  assert.equal(chatBuyable(item("a", { moderation_status: "hidden" }), "me"), false);
  assert.equal(chatBuyable(item("a", { moderation_status: "review" }), "me"), true);
});

test("mySections / myCounts：出品中・購入・売れたに分け、件数は区分の数と同じ", () => {
  const mine = [item("s1"), item("s2", { status: "sold" }), item("s3", { moderation_status: "review" })];
  const purchases: Purchase[] = [{ id: "p1", item: item("b1", { price: 900, status: "sold" }), price: 700, created_at: "2026-11-02T00:00:00Z" }];
  const s = mySections(mine, purchases);
  assert.deepEqual(s.selling.map((i) => i.id), ["s1", "s3"]);
  assert.deepEqual(s.sold.map((i) => i.id), ["s2"]);
  assert.deepEqual(s.bought.map((i) => i.id), ["b1"]);
  assert.equal(s.bought[0].price, 700); // 買ったときの価格
  assert.deepEqual(myCounts(s), { bought: 1, sold: 1, selling: 2 });
  assert.deepEqual(myCounts(mySections([], [])), { bought: 0, sold: 0, selling: 0 });
});
