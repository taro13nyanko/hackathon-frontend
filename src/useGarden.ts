import { useCallback, useEffect, useRef, useState } from "react";
import { getGarden, listMyItems, listMyPurchases, saveGarden, type GardenSpot } from "./api";
import { loadSeen, saveSeen } from "./garden";
import { EMPTY_GARDEN, buildGarden, type GardenData } from "./home";

// 箱庭のデータ（自分の出品・購入・模型の置き場所）を読む・動かした場所を保存する、を1か所にまとめたもの。
// ホーム（list）と箱庭（garden）の両方が同じものを使う（App が1つ持って渡す）。
// myId が "" のとき（未ログイン）は空の箱庭。
export type GardenState = {
  data: GardenData | null; // null は読み込み中
  error: string;
  fresh: number; // 今回の読み込みで NEW になった数
  layoutMsg: string;
  reload: () => void;
  onMove: (id: string, x: number, z: number) => void;
  resetLayout: () => void;
};

export function useGarden(myId: string): GardenState {
  const [data, setData] = useState<GardenData | null>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(0);
  const [layoutMsg, setLayoutMsg] = useState("");
  // 配置の保存：最新の並びを ref に持ち、保存は1本ずつ順番に送る（並べ直しと重なっても、押した順に届く）
  const dataRef = useRef<GardenData | null>(null);
  const saveTimer = useRef(0);
  const dirty = useRef(false);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0); // 続けて読み直したとき、古い応答で上書きしない
  const userRef = useRef(myId);

  // 保存を列の最後に積む（前の保存が終わってから送る）
  const enqueueSave = useCallback((spots: GardenSpot[], done: string) => {
    saving.current = saving.current
      .then(() => saveGarden(spots))
      .then(() => setLayoutMsg(done))
      .catch((err) => setLayoutMsg(err instanceof Error ? err.message : String(err)));
  }, []);

  // まだ送っていない移動があれば、すぐ保存する
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!dirty.current || !userRef.current) return;
    dirty.current = false;
    const entries = dataRef.current?.entries ?? [];
    const spots = entries.filter((e) => e.spot).map((e) => ({ item_id: e.id, x: e.spot!.x, z: e.spot!.z }));
    enqueueSave(spots, "配置を保存しました");
  }, [enqueueSave]);

  const reload = useCallback(() => {
    const n = ++latest.current;
    if (!myId) {
      dataRef.current = EMPTY_GARDEN;
      setData(EMPTY_GARDEN);
      setError("");
      setFresh(0);
      return;
    }
    setError("");
    // 動かした直後の保存が終わってから読む（読み直しで古い置き場所に戻らないように）
    flush();
    saving.current
      .then(() =>
        // 配置が読めなくても（表がまだ無いなど）箱庭は出す。そのときはマス目に並ぶ
        Promise.all([listMyItems(), listMyPurchases(), getGarden().catch(() => [] as GardenSpot[])]),
      )
      .then(([mine, bought, spots]) => {
        if (n !== latest.current) return;
        const d = buildGarden(mine, bought, spots, loadSeen(myId));
        saveSeen(myId, d.entries.map((e) => e.id));
        const newCount = d.entries.filter((e) => e.isNew).length;
        // NEW は「前に見たときから増えた分」。読み直しで消えないよう、前回の NEW の印は残す
        const before = new Set((dataRef.current?.entries ?? []).filter((e) => e.isNew).map((e) => e.id));
        for (const e of d.entries) if (before.has(e.id)) e.isNew = true;
        dataRef.current = d;
        setData(d);
        setFresh((f) => (newCount > 0 ? newCount : f));
      })
      .catch((e) => {
        if (n === latest.current) setError(e instanceof Error ? e.message : String(e));
      });
  }, [myId, flush]);

  // ログインしている人が変わったら、前の人の箱庭は捨てて読み直す
  useEffect(() => {
    if (userRef.current !== myId) {
      clearTimeout(saveTimer.current);
      dirty.current = false;
      dataRef.current = null;
      setData(null);
      setFresh(0);
      setLayoutMsg("");
    }
    userRef.current = myId;
  }, [myId]);

  // タブを隠したとき・ページを閉じるときも、動かした直後の分を送る
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  // 動かした場所を覚え、少し待ってからまとめて保存する（続けて動かしても保存は1回）
  const onMove = useCallback(
    (id: string, x: number, z: number) => {
      const e = dataRef.current?.entries.find((x) => x.id === id);
      if (e) e.spot = { x, z }; // 描き直し（時間帯の切り替えなど）でも、動かした場所に残す
      dirty.current = true;
      setLayoutMsg("");
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 700);
    },
    [flush],
  );

  // 並べ直し：動かした場所を消して、マス目に戻す
  const resetLayout = useCallback(() => {
    clearTimeout(saveTimer.current);
    dirty.current = false;
    const d = dataRef.current;
    if (!d) return;
    const next = { ...d, entries: d.entries.map((e) => ({ ...e, spot: undefined })) };
    dataRef.current = next;
    setData(next);
    enqueueSave([], "きれいに並べ直しました");
  }, [enqueueSave]);

  return { data, error, fresh, layoutMsg, reload, onMove, resetLayout };
}
