import type { Item, Message, Purchase } from "./api";

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
