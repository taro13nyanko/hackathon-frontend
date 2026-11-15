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

// ---- 次の検索の条件（どこから探したかで決める） ----
// header：ヘッダーの検索欄で手で打って送った。価格の範囲は引き継がない（音声で付いた範囲が、気づかないまま残らないように）
// voice：音声検索の結果。範囲はこの1回だけ使う
// clearRange：価格の札の ×。キーワードは残して範囲だけ外す
// tab・all：下部タブの「さがす」・「すべての商品を見る」・「条件を外して全件を見る」。条件なしの全件
export type SearchCond = { q: string; range: PriceRange; heard: string };
export type SearchEvent =
  | { source: "header"; q: string }
  | { source: "voice"; q: string; range: PriceRange; heard: string }
  | { source: "clearRange" }
  | { source: "tab" }
  | { source: "all" };

export function nextSearch(prev: SearchCond, ev: SearchEvent): SearchCond {
  switch (ev.source) {
    case "header":
      return { q: ev.q, range: NO_RANGE, heard: "" };
    case "voice":
      return { q: ev.q, range: ev.range, heard: ev.heard };
    case "clearRange":
      return { q: prev.q, range: NO_RANGE, heard: "" };
    default:
      return { q: "", range: NO_RANGE, heard: "" };
  }
}

// isFiltered は、キーワードか価格の範囲で絞り込んでいるか（「条件を外して全件を見る」を出すか）
export function isFiltered(c: Pick<SearchCond, "q" | "range">): boolean {
  return c.q.trim() !== "" || c.range.min > 0 || c.range.max > 0;
}
