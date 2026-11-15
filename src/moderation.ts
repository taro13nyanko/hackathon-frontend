// 出品の確認（禁止物・不適切な画像）の表示の決まり。画面を使わない部分。

export type ModerationStatus = "ok" | "review" | "hidden";

// カテゴリの日本語名（バックエンドの固定の一覧と同じ）
export const CATEGORY_TEXT: Record<string, string> = {
  weapon: "武器・刃物・模造銃",
  drug: "薬物・医薬品・たばこ・酒",
  adult: "性的な物・露出",
  violence: "暴力・グロテスク",
  counterfeit: "偽ブランド・海賊版",
  living: "生き物",
  personal_info: "個人情報・身分証・チケットの転売",
  money: "現金・金券・ポイント",
  hazardous: "危険物",
  other: "その他",
};

// categoryLabels はカテゴリを日本語名に直す（知らない名前は「その他」にまとめ、同じ名前は1回だけ）。
export function categoryLabels(categories: string[]): string[] {
  return [...new Set(categories.map((c) => CATEGORY_TEXT[c] ?? CATEGORY_TEXT.other))];
}

// moderationNote は商品詳細に出す印。理由（reason）はサーバーが出品者本人と管理者にだけ入れて返す。
export function moderationNote(status: ModerationStatus, reason: string): { kind: "review" | "hidden"; text: string } | null {
  if (status === "review") return { kind: "review", text: reason ? `確認中：${reason}` : "運営が確認中の商品です" };
  if (status === "hidden") return { kind: "hidden", text: reason ? `非公開：${reason}` : "この商品は運営の確認により非公開になっています" };
  return null;
}
