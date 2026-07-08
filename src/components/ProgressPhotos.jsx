import { useState, useRef } from "react";
import { listProgressPhotos, saveProgressPhoto, deleteProgressPhoto } from "../store.js";

// 진행 사진 타임라인 — 몸 변화를 눈으로 확인(동기부여).
// 접힌 섹션으로 시작, 펼칠 때만 Firestore에서 로드(앱 시작 성능·용량 보호).
// 사진은 캔버스로 압축(최대 900px JPEG)해 문서당 1장 저장. JSON 백업엔 포함되지 않음.
export function ProgressPhotos({ date, bodyLog }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState(null); // null=미로드, []=없음
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(null); // 보기 중인 photo
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    const list = await listProgressPhotos();
    if (list === null) { alert("사진을 불러오지 못했어요. 온라인 상태를 확인해주세요."); setPhotos([]); }
    else setPhotos(list);
    setLoading(false);
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && photos === null) load();
  };

  // 파일 → 압축 dataURL (최대 900px, 900KB 넘으면 더 강하게 재압축)
  const compress = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      let out = canvas.toDataURL("image/jpeg", 0.82);
      if (out.length > 900_000) out = canvas.toDataURL("image/jpeg", 0.6);
      if (out.length > 900_000) reject(new Error("too-large"));
      else resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
    img.src = url;
  });

  const addPhoto = async (file) => {
    if (!file) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { alert("사진 저장은 온라인에서만 가능해요."); return; }
    setBusy(true);
    try {
      const image = await compress(file);
      const photo = { date, ts: Date.now(), image };
      const id = await saveProgressPhoto(photo);
      setPhotos((prev) => [...(prev || []), { id, ...photo }].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.ts || 0) - (b.ts || 0)));
    } catch (e) {
      alert(e.message === "too-large" ? "사진이 너무 커요. 다른 사진으로 시도해주세요." : "사진을 저장하지 못했어요.");
    }
    setBusy(false);
  };

  const removePhoto = async (p) => {
    if (!confirm(`${p.date} 사진을 삭제할까요?`)) return;
    try {
      await deleteProgressPhoto(p.id);
      setPhotos((prev) => (prev || []).filter((x) => x.id !== p.id));
      setViewer(null);
    } catch { alert("삭제하지 못했어요. 온라인 상태를 확인해주세요."); }
  };

  // 그 날짜(또는 직전) 체중 — 사진 뷰어에 함께 표시
  const weightAt = (ds) => {
    const past = (bodyLog || []).filter((b) => b.date <= ds);
    return past.length ? past[past.length - 1].weight : null;
  };

  return (
    <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "14px 16px", marginBottom: 10 }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
        <span style={{ fontSize: 13, color: "#8a8a8a", fontWeight: 500 }}>📷 진행 사진{photos && photos.length > 0 ? ` (${photos.length})` : ""}</span>
        <span style={{ fontSize: 10, color: "#707070" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "#707070", fontSize: 12, padding: "14px 0" }}>불러오는 중…</div>
          ) : (
            <>
              {(photos || []).length === 0 && (
                <div style={{ textAlign: "center", color: "#707070", fontSize: 11.5, padding: "10px 0 14px", lineHeight: 1.6 }}>
                  같은 자세·같은 조명으로 꾸준히 찍으면<br />몸의 변화가 눈에 보여요.
                </div>
              )}
              {(photos || []).length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
                  {[...photos].reverse().map((p) => (
                    <div key={p.id} onClick={() => setViewer(p)} style={{ position: "relative", aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "#252525" }}>
                      <img src={p.image} alt={p.date} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 6px 4px", background: "linear-gradient(transparent, rgba(0,0,0,0.75))", fontSize: 9, color: "#f5f5f0", fontFamily: "monospace", textAlign: "center" }}>{p.date.slice(2)}</div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                style={{ width: "100%", padding: 11, background: "rgba(74,143,201,0.1)", border: "1px dashed rgba(74,143,201,0.4)", borderRadius: 11, color: "#4a8fc9", fontSize: 12.5, fontWeight: 500, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "저장 중…" : `＋ ${date} 사진 추가`}
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; addPhoto(f); }} />
              <div style={{ fontSize: 9.5, color: "#4a4a4a", marginTop: 8, lineHeight: 1.5 }}>사진은 압축돼 클라우드에 저장되고, JSON 백업 파일에는 포함되지 않아요.</div>
            </>
          )}
        </div>
      )}

      {/* 뷰어 오버레이 */}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <img src={viewer.image} alt={viewer.date} style={{ maxWidth: "100%", maxHeight: "72vh", borderRadius: 14 }} onClick={(e) => e.stopPropagation()} />
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "#f5f5f0", fontWeight: 600, fontFamily: "monospace" }}>{viewer.date}{weightAt(viewer.date) ? ` · ${weightAt(viewer.date)}kg` : ""}</div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12 }}>
              <span onClick={(e) => { e.stopPropagation(); removePhoto(viewer); }} style={{ fontSize: 12, color: "#e05252", cursor: "pointer" }}>삭제</span>
              <span style={{ fontSize: 12, color: "#8a8a8a", cursor: "pointer" }}>닫기</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
