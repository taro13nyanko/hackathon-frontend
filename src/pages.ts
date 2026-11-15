import type { Conversation, Item, Message, Purchase } from "./api";

// マイページ・メッセージ・ログイン（A-1）の決まり（画面を使わない部分）。App.tsx から使い、tests/pages.test.ts で確かめる。
// ここでは値を import しない（node:test が型だけ取り除いてそのまま読めるように）。

// ---- 頭文字のアバター：表示名の最初の1文字（絵文字や結合文字でも割らない）。空なら「?」 ----
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}

// ---- 「たった今」「5分前」：API の created_at から計算する（日付そのものは出さない） ----
// 未来の時刻（端末の時計のずれ）は「たった今」。読めない値は ""（何も出さない）
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}日前`;
  return "1か月以上前";
}

// ---- メッセージ一覧の「最新のメッセージ」（自分が送った物は「あなた: 」を付ける） ----
export function previewText(last: Pick<Message, "sender_id" | "body"> | null, myId: string): string {
  if (!last) return "（まだメッセージはありません）";
  return `${myId && last.sender_id === myId ? "あなた: " : ""}${last.body}`;
}

// ---- メッセージ画面の商品カードに「購入する」を出すか ----
// 出品中で、出品者がいて（見本データでない）、自分の商品でなく、非公開でないときだけ
export function chatBuyable(item: Pick<Item, "status" | "seller" | "moderation_status">, myId: string): boolean {
  return item.status === "on_sale" && item.seller !== null && item.seller.id !== myId && item.moderation_status !== "hidden";
}

// ---- メッセージ画面の商品カードの印 ----
// 「購入する」（chatBuyable）・「売り切れ」・「あなたの出品」。売り切れと自分の出品は両方当たることがあるので並べて出す
export function chatItemBadges(item: Pick<Item, "status" | "seller" | "moderation_status">, myId: string): { buy: boolean; sold: boolean; own: boolean } {
  return {
    buy: chatBuyable(item, myId),
    sold: item.status === "sold",
    own: myId !== "" && item.seller !== null && item.seller.id === myId,
  };
}

// ---- 未読の数（GET /conversations の unread_count、GET /me/unread の count） ----
// いま開いている会話は、画面に出ているので 0 として扱う（サーバーの既読は PUT …/read で追いつく）
export function unreadOf(c: Pick<Conversation, "id" | "unread_count">, openId: string): number {
  if (c.id === openId) return 0;
  const n = c.unread_count ?? 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function unreadTotal(convs: Pick<Conversation, "id" | "unread_count">[], openId: string): number {
  return convs.reduce((sum, c) => sum + unreadOf(c, openId), 0);
}

// バッジの文字。0 以下は ""（バッジを出さない）、100 以上は「99+」
export function unreadBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > 99 ? "99+" : String(Math.floor(n));
}

// バッジの読み上げ（aria-label）
export const unreadLabel = (n: number) => (unreadBadge(n) ? `未読 ${unreadBadge(n)} 件` : "");

// 会話を既読にしたあとの一覧（その会話の unread_count を 0 にする。ほかは変えない）
export function markConvRead<C extends Pick<Conversation, "id" | "unread_count">>(convs: C[], id: string): C[] {
  return convs.map((c) => (c.id === id && (c.unread_count ?? 0) !== 0 ? { ...c, unread_count: 0 } : c));
}

// ---- 出品者名（一覧・詳細・購入確認・管理で同じ。API の今の表示名。出品者が無い見本データは「（見本データ）」） ----
export const SAMPLE_SELLER = "（見本データ）";
export function sellerName(item: Pick<Item, "seller">): string {
  return item.seller ? item.seller.display_name : SAMPLE_SELLER;
}

// ---- マイページ：3つの区分（出品中・購入した商品・売れた商品）と件数 ----
// 購入した商品の価格は「買ったときの価格」（purchase.price）にする
export type MySections = { selling: Item[]; bought: Item[]; sold: Item[] };

export function mySections(mine: Item[], purchases: Purchase[]): MySections {
  return {
    selling: mine.filter((it) => it.status !== "sold"),
    bought: purchases.map((p) => ({ ...p.item, price: p.price })),
    sold: mine.filter((it) => it.status === "sold"),
  };
}

// 件数チップ「買った N／売った N／出品中 N」（実際の件数。区分の数と必ず同じになる）
export function myCounts(s: MySections): { bought: number; sold: number; selling: number } {
  return { bought: s.bought.length, sold: s.sold.length, selling: s.selling.length };
}

// nextCursor は、メッセージの新着を取りに行く位置（after=）を、サーバーから受け取った分だけで進める。
// ID は ULID（送った順に大きくなる）。何も来なければそのまま、後戻りもしない。
// 自分の送信では進めないこと：進めると、送信の直前に相手が送った（ID が小さい）メッセージを取りこぼす。
export function nextCursor(current: string, received: { id: string }[]): string {
  return received.reduce((max, m) => (m.id > max ? m.id : max), current);
}
