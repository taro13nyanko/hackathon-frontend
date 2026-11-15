// 古い版のタブに気づく決まり（src/version.ts）の単体テスト。index.html から index-*.js の名前を取り出して比べる。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRELOAD_RELOAD_WINDOW_MS,
  VERSION_CHECK_INTERVAL_MS,
  bundleName,
  canReloadAfterPreloadError,
  isNewVersion,
  shouldCheck,
} from "../src/version.ts";

const html = (name: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${name}"></script>` +
  `<link rel="stylesheet" crossorigin href="/assets/index-Cx1.css"></head><body><div id="root"></div></body></html>`;

test("index.html から index-*.js の名前を取り出す（css や別のチャンクは拾わない）", () => {
  assert.equal(bundleName(html("index-Bpy6jV58.js")), "index-Bpy6jV58.js");
  assert.equal(bundleName("/assets/index-Bpy6jV58.js"), "index-Bpy6jV58.js", "script の src だけでも読める");
  assert.equal(bundleName('<script type="module" src="/src/main.tsx"></script>'), "", "開発サーバーは取り出せない");
  assert.equal(bundleName('<script src="/assets/Garden3D-abc.js"></script>'), "");
  assert.equal(bundleName(""), "");
});

test("同じ名前なら false、違えば true、取り出せなければ false", () => {
  assert.equal(isNewVersion("index-Bpy6jV58.js", html("index-Bpy6jV58.js")), false);
  assert.equal(isNewVersion("index-OLD11111.js", html("index-Bpy6jV58.js")), true);
  assert.equal(isNewVersion("index-OLD11111.js", "<html>メンテナンス中</html>"), false, "新しい側が読めない");
  assert.equal(isNewVersion("", html("index-Bpy6jV58.js")), false, "開発サーバー（起動時の名前が無い）では何もしない");
});

test("確かめるのは数分に1回まで", () => {
  assert.equal(shouldCheck(0, 1000), true, "まだ一度も確かめていない");
  assert.equal(shouldCheck(1000, 1000 + VERSION_CHECK_INTERVAL_MS - 1), false);
  assert.equal(shouldCheck(1000, 1000 + VERSION_CHECK_INTERVAL_MS), true);
});

test("チャンクの読み込み失敗での再読込は、印が新しいうちは2回目をしない（無限に再読込しない）", () => {
  const t = 1_000_000;
  assert.equal(canReloadAfterPreloadError(null, t), true, "印が無ければ1回目は再読込する");
  assert.equal(canReloadAfterPreloadError(String(t - 1000), t), false, "直前に再読込した");
  assert.equal(canReloadAfterPreloadError(String(t - PRELOAD_RELOAD_WINDOW_MS), t), true, "時間がたてば、また立ち直れる");
  assert.equal(canReloadAfterPreloadError("こわれた値", t), true);
});
