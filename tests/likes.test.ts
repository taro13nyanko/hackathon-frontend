// いいねの楽観的更新（src/likes.ts）の単体テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { likeAfter, patchLike, toggleLike } from "../src/likes.ts";

test("いいねすると数が1増え、外すと1減る", () => {
  assert.deepEqual(likeAfter({ liked: false, like_count: 3 }, true), { liked: true, like_count: 4 });
  assert.deepEqual(likeAfter({ liked: true, like_count: 4 }, false), { liked: false, like_count: 3 });
});

test("もう同じ状態なら数は変えない（2回押しても2増えない）", () => {
  assert.deepEqual(likeAfter({ liked: true, like_count: 4 }, true), { liked: true, like_count: 4 });
  assert.deepEqual(likeAfter({ liked: false, like_count: 0 }, false), { liked: false, like_count: 0 });
});

test("数は 0 より下にならない（サーバーと食い違っていても）", () => {
  assert.deepEqual(likeAfter({ liked: true, like_count: 0 }, false), { liked: false, like_count: 0 });
});

test("押した → 失敗して戻す、で元の見た目にそろう", () => {
  const before = { liked: false, like_count: 7 };
  const items = [
    { id: "a", title: "A", ...before },
    { id: "b", title: "B", liked: true, like_count: 1 },
  ];
  const shown = patchLike(items, "a", likeAfter(before, true));
  assert.deepEqual(shown[0], { id: "a", title: "A", liked: true, like_count: 8 });
  assert.deepEqual(patchLike(shown, "a", before), items);
});

test("patchLike は指定した商品だけを変え、元の配列は変えない", () => {
  const items = [
    { id: "a", liked: false, like_count: 1 },
    { id: "b", liked: false, like_count: 2 },
  ];
  const got = patchLike(items, "b", { liked: true, like_count: 3 });
  assert.equal(got[0], items[0]); // ほかの商品は同じもの
  assert.deepEqual(got[1], { id: "b", liked: true, like_count: 3 });
  assert.deepEqual(items[1], { id: "b", liked: false, like_count: 2 });
});

test("toggleLike：成功すると、先に見た目を変え、最後はサーバーの数になる", async () => {
  const shown: unknown[] = [];
  const sent: boolean[] = [];
  const msg = await toggleLike(
    { liked: false, like_count: 7 },
    async (liked) => {
      sent.push(liked);
      return { liked: true, like_count: 10 }; // ほかの人のいいねで数がずれていた
    },
    (s) => shown.push(s),
  );
  assert.equal(msg, "");
  assert.deepEqual(sent, [true]);
  assert.deepEqual(shown, [
    { liked: true, like_count: 8 },
    { liked: true, like_count: 10 },
  ]);
});

test("toggleLike：失敗すると、押す前の見た目に戻し、エラーの文言を返す", async () => {
  const shown: unknown[] = [];
  const msg = await toggleLike(
    { liked: true, like_count: 3 },
    async () => {
      throw new Error("いいねが続きすぎです");
    },
    (s) => shown.push(s),
  );
  assert.equal(msg, "いいねが続きすぎです");
  assert.deepEqual(shown, [
    { liked: false, like_count: 2 },
    { liked: true, like_count: 3 },
  ]);
});

test("toggleLike：一覧に当てはめると、失敗のあとは元の一覧と同じになる", async () => {
  const items = [
    { id: "a", liked: false, like_count: 1 },
    { id: "b", liked: true, like_count: 5 },
  ];
  let list = items;
  await toggleLike(items[0], async () => Promise.reject(new Error("x")), (s) => (list = patchLike(list, "a", s)));
  assert.deepEqual(list, items);
});
