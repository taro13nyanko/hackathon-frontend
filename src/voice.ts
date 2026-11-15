// 音声検索の決まり（録音の形式・長さ・マイクのエラーの文言）。画面を使わない部分。

export const VOICE_MAX_MS = 15_000; // 録音は最長15秒（もう一度押すと止める）
export const VOICE_MAX_BYTES = 1_000_000; // バックエンドの上限（1MB、約1分）

// バックエンドが受け付ける形式（POST /search/voice の mime）
export const VOICE_MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;
export type VoiceMime = (typeof VOICE_MIMES)[number];

// 録音に使いたい形式（上から順に試す）。Chrome・Firefox は webm/ogg、Safari は mp4。
const RECORD_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];

// baseMime は "audio/webm;codecs=opus" → "audio/webm"。受け付けない形式なら null。
export function baseMime(type: string): VoiceMime | null {
  const base = type.split(";")[0].trim().toLowerCase();
  return (VOICE_MIMES as readonly string[]).includes(base) ? (base as VoiceMime) : null;
}

// pickRecordingMime は MediaRecorder に渡す形式を選ぶ。どれも使えなければ ""（ブラウザ任せ。録音後に baseMime で確かめる）。
export function pickRecordingMime(isSupported: (type: string) => boolean): string {
  for (const t of RECORD_CANDIDATES) {
    try {
      if (isSupported(t)) return t;
    } catch {
      // isTypeSupported が無い・例外を出すブラウザは次へ
    }
  }
  return "";
}

// micErrorMessage は getUserMedia の失敗（DOMException の name）を、利用者向けの文に直す。
export function micErrorMessage(name: string): string {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "マイクの使用が許可されていません。ブラウザのアドレスバーの設定から、マイクを許可してください";
    case "NotFoundError":
    case "OverconstrainedError":
      return "マイクが見つかりませんでした。マイクをつないでから、もう一度お試しください";
    case "NotReadableError":
    case "AbortError":
      return "マイクを使えませんでした。ほかのアプリがマイクを使っていないか確かめてください";
    default:
      return "この端末・ブラウザでは録音できません。キーワードで検索してください";
  }
}
