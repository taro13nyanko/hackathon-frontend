// マイページ・メッセージ・ログイン（A-1）の決まり（src/pages.ts）の単体テスト。画面は使わない部分だけを確かめる。
// 実行：npm test（Node 24 の node:test）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_SELLER,
  chatBuyable,
  chatItemBadges,
  initialOf,
  markConvRead,
  myCounts,
  mySections,
  nextCursor,
  previewText,
  readTarget,
  relativeTime,
  sellerName,
  unreadBadge,
  unreadLabel,
  unreadOf,
  unreadTotal,
} from "../src/pages.ts";
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

// ---- 2026-11 実機テストの修正 ----

test("chatItemBadges：自分の商品は「あなたの出品」。売り切れなら「売り切れ」と両方。他人の物は買えるときだけ購入", () => {
  const mine = { id: "me", display_name: "わたし" };
  const cases: [string, Item, { buy: boolean; sold: boolean; own: boolean }][] = [
    ["売れていない自分の商品", item("a", { seller: mine }), { buy: false, sold: false, own: true }],
    ["売れた自分の商品", item("b", { seller: mine, status: "sold" }), { buy: false, sold: true, own: true }],
    ["他人の売り切れ", item("c", { status: "sold" }), { buy: false, sold: true, own: false }],
    ["購入できる商品", item("d"), { buy: true, sold: false, own: false }],
    ["他人の非公開", item("e", { moderation_status: "hidden" }), { buy: false, sold: false, own: false }],
  ];
  for (const [why, it, want] of cases) assert.deepEqual(chatItemBadges(it, "me"), want, why);
  // 自分の id が分からない（ログイン前）ときは「あなたの出品」にしない
  assert.equal(chatItemBadges(item("f", { seller: mine }), "").own, false);
});

test("未読：開いている会話は0、無い・負は0。合計とバッジの文字（0は出さない、100以上は99+）", () => {
  const convs = [
    { id: "a", unread_count: 3 },
    { id: "b", unread_count: 0 },
    { id: "c" }, // unread_count が無い（古い応答）
    { id: "d", unread_count: -1 },
    { id: "e", unread_count: 2 },
  ];
  assert.equal(unreadOf(convs[0], ""), 3);
  assert.equal(unreadOf(convs[0], "a"), 0, "開いている会話");
  assert.equal(unreadOf(convs[2], ""), 0);
  assert.equal(unreadOf(convs[3], ""), 0);
  assert.equal(unreadTotal(convs, ""), 5);
  assert.equal(unreadTotal(convs, "a"), 2);
  assert.equal(unreadTotal([], ""), 0);
  assert.equal(unreadBadge(0), "");
  assert.equal(unreadBadge(-2), "");
  assert.equal(unreadBadge(Number.NaN), "");
  assert.equal(unreadBadge(1), "1");
  assert.equal(unreadBadge(99), "99");
  assert.equal(unreadBadge(100), "99+");
  assert.equal(unreadLabel(0), "");
  assert.equal(unreadLabel(4), "未読 4 件");
});

test("markConvRead：その会話だけ0にし、ほかは同じ物のまま", () => {
  const convs = [
    { id: "a", unread_count: 3 },
    { id: "b", unread_count: 1 },
  ];
  const got = markConvRead(convs, "a");
  assert.deepEqual(got, [
    { id: "a", unread_count: 0 },
    { id: "b", unread_count: 1 },
  ]);
  assert.equal(got[1], convs[1]);
  assert.deepEqual(convs[0], { id: "a", unread_count: 3 }, "元の一覧は変えない");
});

test("sellerName：一覧と詳細で同じ（API の今の表示名。出品者なしは見本データ）", () => {
  assert.equal(sellerName(item("a", { seller: { id: "s", display_name: "テスト1" } })), "テスト1");
  assert.equal(sellerName(item("b", { seller: null })), SAMPLE_SELLER);
  assert.equal(SAMPLE_SELLER, "（見本データ）");
});

// ---- メッセージの新着を取りに行く位置 ----

test("取りに行く位置は、受け取った分の最大の ID まで進み、何も来なければそのまま", () => {
  assert.equal(nextCursor("", []), "");
  assert.equal(nextCursor("", [{ id: "01B" }, { id: "01C" }, { id: "01A" }]), "01C");
  assert.equal(nextCursor("01C", []), "01C");
  assert.equal(nextCursor("01C", [{ id: "01B" }]), "01C"); // 後戻りしない
});

test("送信の直前に相手が送ったメッセージを取りこぼさない（位置は自分の送信では進めない）", () => {
  // 位置 01B のあと、相手が 01C を送り、自分が 01D を送った。次の取得は after=01B なので 01C も 01D も来る
  let cursor = "01B";
  const sentByMe = { id: "01D" };
  void sentByMe; // 送信は画面に足すだけで、位置は変えない
  const nextPoll = [{ id: "01C" }, { id: "01D" }].filter((m) => m.id > cursor);
  assert.deepEqual(nextPoll.map((m) => m.id), ["01C", "01D"]);
  cursor = nextCursor(cursor, nextPoll);
  assert.equal(cursor, "01D");
});

// ---- 既読は画面が見えているときだけ（2026-11 再テスト：裏のウィンドウで既読になり、未読がどこにも出なかった件） ----

test("既読にする位置：見えていて先に進んだときだけ。裏では送らず、後戻り・同じ位置の二重送信もしない", () => {
  assert.equal(readTarget("01B", "01A", true), "01B");
  assert.equal(readTarget("01B", "01A", false), null, "裏では既読にしない");
  assert.equal(readTarget("01A", "01B", true), null, "後戻りしない");
  assert.equal(readTarget("01B", "01B", true), null, "同じ位置は2回送らない（focus と visibilitychange が重なっても）");
  assert.equal(readTarget("", "", true), null, "まだ何も出していない");
});

test("未読：見えていないときは、開いている会話もサーバーの数を使う（既定は見えている扱いで前と同じ）", () => {
  assert.equal(unreadOf({ id: "c1", unread_count: 2 }, "c1", true), 0);
  assert.equal(unreadOf({ id: "c1", unread_count: 2 }, "c1", false), 2);
  assert.equal(unreadOf({ id: "c2", unread_count: 1 }, "c1", true), 1);
  assert.equal(unreadOf({ id: "c1", unread_count: 2 }, "c1"), 0, "引数を省くと見えている扱い");
  const convs = [
    { id: "c1", unread_count: 2 },
    { id: "c2", unread_count: 1 },
  ];
  assert.equal(unreadTotal(convs, "c1"), 1);
  assert.equal(unreadTotal(convs, "c1", false), 3);
});
