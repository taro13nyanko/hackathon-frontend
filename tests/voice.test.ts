// 音声検索の決まり（src/voice.ts）の単体テスト。録音の形式の選び方とマイクのエラーの文言。
import { test } from "node:test";
import assert from "node:assert/strict";
import { VOICE_MIMES, VOICE_PERMISSION_TIMEOUT_MS, baseMime, micErrorMessage, permissionHint, pickRecordingMime, withTimeout } from "../src/voice.ts";

test("Chrome のように webm(opus) が使えるなら、それを選ぶ", () => {
  assert.equal(pickRecordingMime(() => true), "audio/webm;codecs=opus");
});

test("Safari のように mp4 しか使えないなら mp4", () => {
  assert.equal(pickRecordingMime((t) => t === "audio/mp4"), "audio/mp4");
});

test("どれも使えない・isTypeSupported が例外を出すなら空（ブラウザ任せ）", () => {
  assert.equal(pickRecordingMime(() => false), "");
  assert.equal(
    pickRecordingMime(() => {
      throw new Error("not supported");
    }),
    "",
  );
});

test("選ぶ形式は、どれもバックエンドが受け付ける形式になる", () => {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"]) {
    const got = pickRecordingMime((x) => x === t);
    assert.equal(got, t);
    assert.notEqual(baseMime(got), null, t);
  }
});

test("baseMime は codecs などを外し、受け付けない形式は null", () => {
  assert.equal(baseMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(baseMime("Audio/MP4; codecs=mp4a.40.2"), "audio/mp4");
  assert.equal(baseMime("audio/wav"), "audio/wav");
  assert.equal(baseMime("video/webm"), null);
  assert.equal(baseMime("audio/x-m4a"), null);
  assert.equal(baseMime(""), null);
  assert.deepEqual([...VOICE_MIMES], ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]);
});

test("マイクのエラーは、拒否・無い・使用中・その他で文言が違う", () => {
  const denied = micErrorMessage("NotAllowedError");
  const missing = micErrorMessage("NotFoundError");
  const busy = micErrorMessage("NotReadableError");
  const other = micErrorMessage("");
  assert.match(denied, /許可/);
  assert.match(missing, /見つかりません/);
  assert.match(busy, /ほかのアプリ/);
  assert.match(other, /キーワードで検索/);
  assert.equal(new Set([denied, missing, busy, other]).size, 4);
});

// ---- マイクの許可を待つ間（2026-11 再テスト：「準備中…」のまま固まった件） ----

test("withTimeout：返ってこない Promise は TimeoutError で失敗にする", async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => {}), 20), (e: Error) => e.name === "TimeoutError");
  assert.equal(VOICE_PERMISSION_TIMEOUT_MS, 10_000);
});

test("withTimeout：期限内に決まればその値・その失敗のまま", async () => {
  assert.equal(await withTimeout(Promise.resolve("stream"), 1000), "stream");
  const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  await assert.rejects(withTimeout(Promise.reject(denied), 1000), (e: Error) => e.name === "NotAllowedError");
});

test("withTimeout：期限のあとで届いた値は onLate に1回だけ渡す（遅れたマイクを放す道）", async () => {
  const late: string[] = [];
  const p = new Promise<string>((resolve) => setTimeout(() => resolve("late-stream"), 50));
  await assert.rejects(withTimeout(p, 10, (v) => late.push(v)), (e: Error) => e.name === "TimeoutError");
  assert.deepEqual(late, [], "失敗にした時点ではまだ届いていない");
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(late, ["late-stream"]);
});

test("時間切れの文言はアドレスバーのマイクに触れ、もう一度押すこと・キーワードでも探せることを言う。ブロック済みは先に案内する", () => {
  const msg = micErrorMessage("TimeoutError");
  assert.match(msg, /アドレスバーのマイクのアイコン/);
  assert.match(msg, /もう一度🎤を押してください/);
  assert.match(msg, /キーワードでも探せます/);
  assert.equal(permissionHint("denied"), micErrorMessage("NotAllowedError"));
  assert.equal(permissionHint("prompt"), null);
  assert.equal(permissionHint("granted"), null);
});
