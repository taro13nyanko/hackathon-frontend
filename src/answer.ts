// 商品への質問（RAG）の答えを画面に出すための決まり。画面を使わない部分。

// 答えの文を「文字」と「根拠の番号 [n]」に分けたもの
export type AnswerPart = { kind: "text"; text: string } | { kind: "ref"; id: number };

// splitAnswer は "…[1]…[3]" を文字と番号に分ける。根拠の一覧に無い番号は消す（サーバーでも消しているが念のため）。
export function splitAnswer(answer: string, ids: Iterable<number>): AnswerPart[] {
  const known = new Set(ids);
  const parts: AnswerPart[] = [];
  const push = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  };
  let at = 0;
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    push(answer.slice(at, m.index));
    const id = Number(m[1]);
    if (known.has(id)) parts.push({ kind: "ref", id });
    at = m.index + m[0].length;
  }
  push(answer.slice(at));
  return parts;
}

// 根拠の種類の札。item と rule は仕様書どおり。それ以外の名前は分かる範囲で受け、知らない種類は「資料」
const KIND_TEXT: Record<string, string> = {
  item: "この商品",
  seller_item: "出品者の他の商品",
  rule: "アプリの決まり",
  figure: "模型",
};

export function sourceKindText(kind: string): string {
  return KIND_TEXT[kind] ?? "資料";
}
