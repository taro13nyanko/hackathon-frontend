// いいねの決まり（画面を使わない部分）。押した瞬間に見た目を変え（楽観的更新）、失敗したら元に戻す。

export type LikeState = { liked: boolean; like_count: number };

// likeAfter は「いいね」を liked にしたあとの見た目。もう同じ状態なら数は変えない。数は 0 より下にしない。
export function likeAfter(cur: LikeState, liked: boolean): LikeState {
  if (cur.liked === liked) return { liked, like_count: cur.like_count };
  return { liked, like_count: Math.max(0, cur.like_count + (liked ? 1 : -1)) };
}

// patchLike は一覧の中の1件だけ、いいねの状態を差し替える（ほかの商品はそのまま）。
export function patchLike<T extends { id: string } & LikeState>(items: T[], id: string, s: LikeState): T[] {
  return items.map((it) => (it.id === id ? { ...it, liked: s.liked, like_count: s.like_count } : it));
}

// toggleLike は「押す」の流れ全体。先に likeAfter の見た目を show で出し、send（PUT／DELETE）を待つ。
// 成功したらサーバーの数で上書きし、失敗したら押す前の見た目に戻して、エラーの文言を返す（成功なら ""）。
export async function toggleLike(
  cur: LikeState,
  send: (liked: boolean) => Promise<LikeState>,
  show: (s: LikeState) => void,
): Promise<string> {
  const before: LikeState = { liked: cur.liked, like_count: cur.like_count };
  const want = !cur.liked;
  show(likeAfter(before, want));
  try {
    show(await send(want));
    return "";
  } catch (e) {
    show(before);
    return e instanceof Error ? e.message : String(e);
  }
}
