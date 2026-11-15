// 古い版のまま開きっぱなしのタブに気づくための決まり（画面を使わない部分）。App.tsx から使い、tests/version.test.ts で確かめる。
// SPA なので、新しい版を出しても開いているタブの JS は入れ替わらない。index.html が読み込む /assets/index-*.js の名前で版を見分ける。
// ここでは値を import しない（node:test が型だけ取り除いてそのまま読めるように）。

// 確かめに行く間隔（これより短い間には読み直さない）
export const VERSION_CHECK_INTERVAL_MS = 3 * 60_000;

// bundleName は、index.html の中身（または <script> の src）から "index-XXXX.js" を取り出す。無ければ ""。
// 開発サーバー（vite dev）では /src/main.tsx を読むので "" になる＝版の確かめはしない
export function bundleName(text: string): string {
  const m = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(text);
  return m ? m[1] : "";
}

// isNewVersion は、起動時の名前（current）と、いま配信中の index.html（html）を比べる。
// どちらかが取り出せなければ false（分からないときは「新しい版」と言わない）
export function isNewVersion(current: string, html: string): boolean {
  const latest = bundleName(html);
  return current !== "" && latest !== "" && latest !== current;
}

// shouldCheck は、前に確かめた時刻（last、まだなら 0）から間隔がたったか
export function shouldCheck(last: number, now: number, interval = VERSION_CHECK_INTERVAL_MS): boolean {
  return last === 0 || now - last >= interval;
}

// ---- 古いチャンク（3D 模型など、あとから読む JS）の読み込みに失敗したとき（vite:preloadError）の再読込 ----
// 再読込は1回だけ。sessionStorage に時刻の印を付け、印が新しいうちは再読込しない（読み込みが失敗し続ける環境で、再読込が止まらなくならないように）。
// 印は時間がたてば無効にする（同じタブで、あとでまた新しい版が出たときに立ち直れるように）
export const PRELOAD_RELOAD_KEY = "fleamarket:preload-reload";
export const PRELOAD_RELOAD_WINDOW_MS = 5 * 60_000;

export function canReloadAfterPreloadError(mark: string | null, now: number, windowMs = PRELOAD_RELOAD_WINDOW_MS): boolean {
  if (!mark) return true;
  const at = Number(mark);
  if (!Number.isFinite(at)) return true;
  return now - at >= windowMs || now < at;
}
