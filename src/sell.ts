// 出品フォームの価格（画面を使わない部分）。App.tsx から使い、tests/sell.test.ts で確かめる。
// ここでは値を import しない（node:test が型だけ取り除いてそのまま読めるように）。
//
// 価格の欄は type="number" をやめて文字の欄にしている。type="number" は、欄にカーソルが乗ったままホイールを回したり
// ↑↓キーを押したりすると、step（1）ずつ値が勝手に増減する（3刻みのスクロールで 500 → 497 になる）。
// 文字の欄なら値は打った文字のままで、送るときに一度だけ整数にする。

// normalizePriceInput は入力中の文字をそろえる：全角数字・全角記号を半角に（NFKC）し、
// 桁区切りのカンマ・空白・「¥」「円」を除く。それ以外の文字（小数点や英字）は残して、送るときに誤りとして知らせる
export function normalizePriceInput(text: string): string {
  return text.normalize("NFKC").replace(/[,、\s¥\\円]/g, "");
}

// parsePrice は入力の文字を整数の価格にする。数字だけでなければ null（丸めたり、読める所だけ拾ったりしない）
export function parsePrice(text: string): number | null {
  const t = normalizePriceInput(text);
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

// priceError は範囲外・整数でないときの一言（よければ ""）
export function priceError(text: string, min: number, max: number): string {
  const p = parsePrice(text);
  if (p === null || p < min || p > max) return `価格は ¥${min.toLocaleString("ja-JP")}〜¥${max.toLocaleString("ja-JP")} の整数で入力してください`;
  return "";
}
