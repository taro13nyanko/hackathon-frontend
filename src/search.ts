// 一覧の検索条件（キーワード・価格の範囲）。画面を使わない部分。

// PriceRange の 0 は「指定なし」（バックエンドの GET /items と同じ）。
export type PriceRange = { min: number; max: number };
export const NO_RANGE: PriceRange = { min: 0, max: 0 };

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// priceRangeLabel は価格の札の文字。両方 0 なら ""（札を出さない）。
export function priceRangeLabel(r: PriceRange): string {
  if (r.min > 0 && r.max > 0) return `${yen(r.min)} 〜 ${yen(r.max)}`;
  if (r.max > 0) return `〜 ${yen(r.max)}`;
  if (r.min > 0) return `${yen(r.min)} 〜`;
  return "";
}

// itemsQuery は GET /items の ?以降（何も無ければ ""）。空のキーワード・0 の価格は付けない。
export function itemsQuery(keyword: string, r: PriceRange = NO_RANGE): string {
  const p = new URLSearchParams();
  if (keyword.trim()) p.set("q", keyword.trim());
  if (r.min > 0) p.set("min_price", String(Math.floor(r.min)));
  if (r.max > 0) p.set("max_price", String(Math.floor(r.max)));
  const s = p.toString();
  return s ? `?${s}` : "";
}
