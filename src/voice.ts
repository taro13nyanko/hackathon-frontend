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
    case "TimeoutError":
      return "マイクの許可を確認できませんでした。アドレスバーのマイクのアイコンから許可したら、もう一度🎤を押してください。キーワードでも探せます";
    default:
      return "この端末・ブラウザでは録音できません。キーワードで検索してください";
  }
}

// ---- マイクの許可を待つ間（許可の吹き出しが出ない・見えないまま、getUserMedia が返ってこないことがある） ----
export const VOICE_PERMISSION_TIMEOUT_MS = 10_000; // これを過ぎたら待つのをやめて案内を出す
export const VOICE_WAIT_HINT_MS = 3_000; // これだけ待っても返ってこなければ、先に一言出す
export const VOICE_WAIT_HINT = "アドレスバー付近にマイクの許可が出ていないか確かめてください";

// withTimeout は、p が ms 以内に決まらなければ name="TimeoutError" のエラーで失敗にする。
// そのあとで p が成功したら、その値を onLate に渡す（遅れて届いたマイクの stream を止めて、マイクを放すため）
export function withTimeout<T>(p: Promise<T>, ms: number, onLate?: (v: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      const err = new Error("時間切れ");
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    p.then(
      (v) => {
        if (late) onLate?.(v);
        else {
          clearTimeout(timer);
          resolve(v);
        }
      },
      (e) => {
        if (late) return;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// permissionHint は、navigator.permissions.query({ name: "microphone" }) の state から、先に出す案内を決める。
// ブロック済み（denied）なら、許可されていないときと同じ文。それ以外（prompt・granted）は null（そのまま getUserMedia へ）
export function permissionHint(state: string): string | null {
  return state === "denied" ? micErrorMessage("NotAllowedError") : null;
}
