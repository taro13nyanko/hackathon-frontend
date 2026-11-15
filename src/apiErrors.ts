// API のエラー応答を、画面に出すエラーに直す決まり（通信をしない純粋な部分）。
// api.ts はここを使う。バックエンドの応答の形（422 の reason／categories、エラーコード）が変わったら、
// tests/apiErrors.test.ts が落ちるようにしてある。

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// 出品の確認で止められた（422 prohibited）。理由とカテゴリをフォームの上に出す
export class ProhibitedError extends ApiError {
  reason: string;
  categories: string[];
  constructor(reason: string, categories: string[]) {
    super("この商品は出品できません", 422, "prohibited");
    this.reason = reason;
    this.categories = categories;
  }
}

// codeOf は応答本文の error（エラーコード）を取り出す。形が違えば ""。
export function codeOf(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return "";
}

// toApiError は「エラーコード → 日本語」の表で文言を決める。表に無いコードは「fallback (HTTP 番号)」。
export function toApiError(status: number, code: string, messages: Record<string, string>, fallback: string): ApiError {
  return new ApiError(messages[code] ?? `${fallback} (HTTP ${status})`, status, code);
}

// prohibitedFrom は 422 の本文から ProhibitedError を作る。reason が文字列でなければ ""、
// categories が配列でなければ []、配列の中の文字列以外は捨てる。
export function prohibitedFrom(body: unknown): ProhibitedError {
  const b = (body && typeof body === "object" ? body : {}) as { reason?: unknown; categories?: unknown };
  const reason = typeof b.reason === "string" ? b.reason : "";
  const categories = Array.isArray(b.categories) ? b.categories.filter((c): c is string => typeof c === "string") : [];
  return new ProhibitedError(reason, categories);
}

// ---- API ごとの「エラーコード → 日本語」の表 ----

export const LIKE_MESSAGES: Record<string, string> = {
  not_found: "この商品は見つかりませんでした",
  too_many: "いいねが続きすぎです。少し待ってから、もう一度お試しください（1分に60回まで）",
  profile_required: "表示名を登録してください",
  unauthorized: "ログインし直してください",
};

export const VOICE_MESSAGES: Record<string, string> = {
  invalid_input: "この録音は使えませんでした（約1分・1MB まで）。もう一度お試しください",
  too_many: "少し時間をおいてから、もう一度お試しください（1分に10回まで）",
  ai_failed: "うまく聞き取れませんでした。もう一度お試しください",
  profile_required: "表示名を登録してください",
  unauthorized: "ログインし直してください",
};

export const QUESTION_MAX = 200; // バックエンドと同じ

export const ASK_MESSAGES: Record<string, string> = {
  invalid_input: `質問は1〜${QUESTION_MAX}文字で入力してください`,
  not_found: "この商品は見つかりませんでした",
  too_many: "少し時間をおいてから、もう一度お試しください（1分に5回まで）",
  ai_failed: "答えを作れませんでした。もう一度お試しください",
  profile_required: "表示名を登録してください",
  unauthorized: "ログインし直してください",
};

export const MODERATION_NOTE_MAX = 120; // バックエンドと同じ

export const ADMIN_MESSAGES: Record<string, string> = {
  forbidden: "管理者だけが使えます",
  not_found: "商品が見つかりませんでした",
  invalid_input: `メモは${MODERATION_NOTE_MAX}文字までです`,
  unauthorized: "ログインし直してください",
};

// 出品の決まり（バックエンドの usecase/item.go と同じ値にしておく）
export const ITEM_RULES = { titleMax: 40, descriptionMax: 1000, priceMin: 300, priceMax: 9_999_999 };

// createItemError は出品（POST /items）の失敗を、画面に出すエラーに直す。成功（2xx）のときは呼ばない。
export function createItemError(status: number, body: unknown): Error {
  if (status === 400) {
    const r = ITEM_RULES;
    return new Error(
      `商品名は1〜${r.titleMax}文字、説明は${r.descriptionMax}文字まで、価格は${r.priceMin.toLocaleString()}〜${r.priceMax.toLocaleString()}円で入力してください`,
    );
  }
  if (status === 401) return new ApiError("ログインし直してください", 401, "unauthorized");
  if (status === 403) return new ApiError("表示名を登録してから出品してください", 403, "profile_required");
  if (status === 422) return prohibitedFrom(body);
  if (status === 429) return new ApiError("出品が続きすぎです。1分ほど待ってから、もう一度お試しください（1分に10件まで）", 429, "too_many");
  return new Error(`出品に失敗しました (HTTP ${status})`);
}
