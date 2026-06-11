import { useState, useEffect } from "react";
import { getProfiles, saveProfiles } from "../store.js";
import { THEME, PROFILE_COLORS } from "../theme.jsx";
import { ProfileSetup } from "./ProfileSetup.jsx";

/* ───── 비밀번호 해싱 (평문 저장 방지 + brute-force 저항) ─────
   PBKDF2-HMAC-SHA256 (10만 회 반복) + 프로필별 랜덤 salt 사용.
   저장 포맷에 algo/iters를 함께 기록해 향후 파라미터 상향이 가능하다.
   crypto.subtle은 보안 컨텍스트(https/localhost)에서만 동작하므로,
   불가한 환경(예: http://LAN-IP)에서는 기존 평문 방식으로 폴백한다. */
const PWD_ALGO = "pbkdf2-sha256";
const PBKDF2_ITERS = 100000;

function cryptoAvailable() {
  return typeof crypto !== "undefined" && crypto.subtle
    && typeof crypto.subtle.deriveBits === "function"
    && typeof crypto.subtle.importKey === "function";
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
function genSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}
// PBKDF2 파생 (현재 방식)
async function pbkdf2Hash(password, saltHex, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" },
    keyMaterial, 256
  );
  return bytesToHex(new Uint8Array(bits));
}
// 레거시 단일 SHA-256 (이전 구현 호환용 — 검증 시에만 사용)
async function sha256Hash(password, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + password));
  return bytesToHex(new Uint8Array(buf));
}
// 비밀번호 필드 생성 (생성/업그레이드 공통)
async function makePasswordFields(plainPw) {
  const passwordSalt = genSalt();
  const passwordHash = await pbkdf2Hash(plainPw, passwordSalt, PBKDF2_ITERS);
  return { passwordHash, passwordSalt, passwordAlgo: PWD_ALGO, passwordIters: PBKDF2_ITERS };
}
// 검증: PBKDF2 → 레거시 SHA-256 → 평문 순으로 호환 (어떤 단계 사용자든 잠금 없음)
async function verifyProfilePassword(profile, candidate) {
  if (profile.passwordAlgo === PWD_ALGO) {
    if (!cryptoAvailable()) return false;
    try { return (await pbkdf2Hash(candidate, profile.passwordSalt || "", profile.passwordIters || PBKDF2_ITERS)) === profile.passwordHash; }
    catch { return false; }
  }
  if (profile.passwordHash) { // 레거시 단일 SHA-256
    if (!cryptoAvailable()) return false;
    try { return (await sha256Hash(candidate, profile.passwordSalt || "")) === profile.passwordHash; }
    catch { return false; }
  }
  if (profile.password != null) return candidate === profile.password; // 평문
  return false;
}

// 로그인 화면 (A안 - 프로필 선택형)
export function LoginScreen({ onLogin }) {
  const [profiles, setProfiles] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pwModal, setPwModal] = useState(null); // 비밀번호 입력 대상 프로필
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState(null); // 삭제 대상 인덱스
  const [adminPw, setAdminPw] = useState("");
  const [adminPwError, setAdminPwError] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // 관리자 마스터키는 클라이언트 번들에 두지 않고 서버(/api/verify-master)에서 검증
  // 본인 비번은 클라이언트에서 즉시 비교 (서버 라운드트립 불필요)
  const verifyMasterKey = async (candidate) => {
    try {
      const res = await fetch("/api/verify-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pw: candidate }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.ok;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    getProfiles().then(p => { setProfiles(p); setLoading(false); });
  }, []);

  const handleCreate = async (profile) => {
    let toSave = profile;
    // 비밀번호가 있으면 해싱하여 저장 (평문 저장 방지)
    if (profile.password && cryptoAvailable()) {
      try {
        const { password, ...rest } = profile;
        toSave = { ...rest, ...(await makePasswordFields(profile.password)) };
      } catch (e) { console.error("password hashing failed, storing as-is:", e); }
    }
    const newProfiles = [...profiles, toSave];
    setProfiles(newProfiles);
    await saveProfiles(newProfiles);
    setShowNew(false);
    onLogin(toSave);
  };

  const handleDeleteRequest = (idx, e) => {
    e.stopPropagation();
    setDeleteIdx(idx);
    setAdminPw("");
    setAdminPwError(false);
  };

  const handleDeleteConfirm = async () => {
    if (deleteSubmitting) return;
    setDeleteSubmitting(true);
    try {
      const ok = await verifyMasterKey(adminPw);
      if (!ok) {
        setAdminPwError(true);
        return;
      }
      const newProfiles = profiles.filter((_, i) => i !== deleteIdx);
      setProfiles(newProfiles);
      await saveProfiles(newProfiles);
      setDeleteIdx(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleProfileClick = (profile) => {
    if (profile.password || profile.passwordHash) {
      setPwModal(profile);
      setPw("");
      setPwError(false);
    } else {
      onLogin(profile);
    }
  };

  // 로그인 성공 시, 아직 PBKDF2가 아닌 프로필(평문 또는 레거시 SHA-256)을 자동 업그레이드
  const upgradePasswordIfNeeded = async (profile, plainPw) => {
    if (profile.passwordAlgo === PWD_ALGO || !cryptoAvailable()) return;
    if (!profile.passwordHash && profile.password == null) return; // 비번 없는 프로필
    try {
      const fields = await makePasswordFields(plainPw);
      const upgraded = profiles.map(p => {
        if (p === profile || (p.id === profile.id && p.createdAt === profile.createdAt)) {
          const { password, ...rest } = p;
          return { ...rest, ...fields };
        }
        return p;
      });
      setProfiles(upgraded);
      await saveProfiles(upgraded);
    } catch (e) { console.error("password upgrade failed:", e); }
  };

  const handlePwSubmit = async () => {
    if (pwSubmitting) return;
    setPwSubmitting(true);
    try {
      // 1) 본인 비번 검증 (해시 또는 평문) — 오프라인에서도 동작
      if (await verifyProfilePassword(pwModal, pw)) {
        await upgradePasswordIfNeeded(pwModal, pw);
        setPwModal(null);
        onLogin(pwModal);
        return;
      }
      // 2) 마스터키는 서버에서 검증 (브루트포스 방지 + 번들 노출 제거)
      const ok = await verifyMasterKey(pw);
      if (ok) {
        setPwModal(null);
        onLogin(pwModal);
      } else {
        setPwError(true);
      }
    } finally {
      setPwSubmitting(false);
    }
  };

  if (loading) return <div style={{ background: THEME.bg, color: THEME.sub, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>로딩 중...</div>;

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "60px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 6, letterSpacing: "-0.5px" }}>Daniel Body Plan</div>
        <div style={{ fontSize: 12, color: THEME.gold, opacity: 0.6, letterSpacing: "2px", textTransform: "uppercase" }}>사용자를 선택하세요</div>
      </div>

      {showNew ? (
        <ProfileSetup onSave={handleCreate} onCancel={() => setShowNew(false)} colorIdx={profiles.length} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {profiles.map((p, i) => (
              <div key={i} onClick={() => handleProfileClick(p)} className="dbp-btn dbp-fade"
                style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: "18px 10px", textAlign: "center", cursor: "pointer", position: "relative", boxShadow: THEME.shadow, animationDelay: `${i * 0.06}s` }}>
                <button onClick={(e) => handleDeleteRequest(i, e)}
                  style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: THEME.hint, fontSize: 14, cursor: "pointer" }}>✕</button>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: p.color || PROFILE_COLORS[i % PROFILE_COLORS.length], margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, color: "#fff" }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: THEME.sub, marginTop: 4 }}>목표 체지방 {p.targetFat}%</div>
                {(p.password || p.passwordHash) && <div style={{ fontSize: 10, color: THEME.hint, marginTop: 4 }}>🔒</div>}
              </div>
            ))}

            <div onClick={() => setShowNew(true)} className="dbp-btn dbp-fade"
              style={{ background: THEME.card, border: `1px dashed rgba(212,175,55,0.2)`, borderRadius: 16, padding: "18px 10px", textAlign: "center", cursor: "pointer", boxShadow: THEME.shadow }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: THEME.surface, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: THEME.gold }}>+</div>
              <div style={{ fontSize: 15, color: THEME.sub }}>새 사용자</div>
              <div style={{ fontSize: 11, color: THEME.hint, marginTop: 4 }}>추가하기</div>
            </div>
          </div>
        </>
      )}

      {/* 비밀번호 입력 모달 */}
      {pwModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setPwModal(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 340, background: "#1e1e1e", borderRadius: 16, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: pwModal.color || "#4a8fc9", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, color: "#fff" }}>
                {pwModal.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{pwModal.name}</div>
            </div>
            <div style={{ fontSize: 12, color: "#707070", marginBottom: 6 }}>비밀번호</div>
            <input type="password" value={pw} onChange={e => { setPw(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handlePwSubmit()}
              placeholder="비밀번호를 입력하세요"
              autoFocus
              style={{ width: "100%", padding: 12, background: "#252525", border: `1px solid ${pwError ? "#e05252" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
            {pwError && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>비밀번호가 틀렸습니다</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPwModal(null)} disabled={pwSubmitting} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 16, color: "#8a8a8a", fontSize: 14, cursor: pwSubmitting ? "not-allowed" : "pointer", opacity: pwSubmitting ? 0.6 : 1 }}>취소</button>
              <button onClick={handlePwSubmit} disabled={pwSubmitting} style={{ flex: 1, padding: 12, background: "#d4af37", border: "none", borderRadius: 12, color: "#141414", fontSize: 14, fontWeight: 500, cursor: pwSubmitting ? "not-allowed" : "pointer", opacity: pwSubmitting ? 0.6 : 1 }}>{pwSubmitting ? "확인 중..." : "로그인"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 비밀번호 삭제 모달 */}
      {deleteIdx !== null && profiles[deleteIdx] && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setDeleteIdx(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 340, background: "#1e1e1e", borderRadius: 16, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: "#e05252" }}>프로필 삭제</div>
              <div style={{ fontSize: 13, color: "#707070", marginTop: 6 }}>"{profiles[deleteIdx].name}"을(를) 삭제하려면<br/>관리자 비밀번호를 입력하세요</div>
            </div>
            <input type="password" value={adminPw} onChange={e => { setAdminPw(e.target.value); setAdminPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handleDeleteConfirm()}
              placeholder="관리자 비밀번호"
              autoFocus
              style={{ width: "100%", padding: 12, background: "#252525", border: `1px solid ${adminPwError ? "#e05252" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
            {adminPwError && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>관리자 비밀번호가 틀렸습니다</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setDeleteIdx(null)} disabled={deleteSubmitting} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 16, color: "#8a8a8a", fontSize: 14, cursor: deleteSubmitting ? "not-allowed" : "pointer", opacity: deleteSubmitting ? 0.6 : 1 }}>취소</button>
              <button onClick={handleDeleteConfirm} disabled={deleteSubmitting} style={{ flex: 1, padding: 12, background: "#e05252", border: "none", borderRadius: 16, color: "#fff", fontSize: 14, fontWeight: 500, cursor: deleteSubmitting ? "not-allowed" : "pointer", opacity: deleteSubmitting ? 0.6 : 1 }}>{deleteSubmitting ? "확인 중..." : "삭제"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
