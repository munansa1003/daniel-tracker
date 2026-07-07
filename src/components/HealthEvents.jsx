import { useState } from "react";
import { HEALTH_TYPES, typeMeta, eventDays, dateInEvent } from "../healthEvents.js";

// 건강 이벤트(부상·질병·휴식·기타) 관리 — 목록 + 추가/수정 폼.
//  events: [{id,type,label,start,end|null,note,exclude}]  onChange(next)
//  기간: 시작일은 항상, 종료일은 선택('오늘 회복' 빠른 지정 또는 '＋ 종료일'로 날짜 선택).
//  end 없음=진행중(무기한), end 미래=예정 종료, end 과거=종료됨.
export function HealthEvents({ events, onChange, todayStr }) {
  const list = events || [];
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [endOpen, setEndOpen] = useState(false); // 종료일 입력칸 표시 여부

  const blank = () => ({ id: Date.now(), type: "injury", label: "", start: todayStr, end: null, note: "", exclude: false });
  const [form, setForm] = useState(blank());

  const openNew = () => { setForm(blank()); setEndOpen(false); setEditing("new"); };
  const openEdit = (ev) => { setForm({ ...ev }); setEndOpen(false); setEditing(ev.id); };
  const cancel = () => setEditing(null);

  const openEnd = () => { setForm((f) => ({ ...f, end: f.end || todayStr })); setEndOpen(true); };
  const removeEnd = () => { setForm((f) => ({ ...f, end: null })); setEndOpen(false); };
  const recoverToday = () => { setForm((f) => ({ ...f, end: todayStr })); setEndOpen(false); };

  const save = () => {
    const clean = {
      id: form.id, type: form.type, label: (form.label || "").trim(),
      start: form.start, end: form.end || null,
      note: (form.note || "").trim(), exclude: !!form.exclude,
    };
    if (clean.end && clean.end < clean.start) clean.end = clean.start;
    const next = editing === "new" ? [...list, clean] : list.map((e) => (e.id === clean.id ? clean : e));
    onChange(next);
    setEditing(null);
  };
  const remove = (id) => { onChange(list.filter((e) => e.id !== id)); setEditing(null); };
  const recover = (ev, e) => { e.stopPropagation(); onChange(list.map((x) => (x.id === ev.id ? { ...x, end: todayStr } : x))); };
  const reopen = (ev, e) => { e.stopPropagation(); onChange(list.map((x) => (x.id === ev.id ? { ...x, end: null } : x))); };

  const activeList = list.filter((e) => dateInEvent(todayStr, e)).sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  const endedList = list.filter((e) => !dateInEvent(todayStr, e)).sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  const ordered = [...activeList, ...endedList];

  const inputStyle = { width: "100%", background: "#232323", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, color: "#f5f5f0", fontSize: 13, padding: "11px 12px", fontFamily: "inherit" };
  const dateStyle = { background: "#232323", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 11, color: "#f5f5f0", fontSize: 15, fontWeight: 500, padding: "11px 13px", fontFamily: "inherit", colorScheme: "dark", width: "auto", minWidth: 156, maxWidth: "100%" };
  const pill = { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 15px", borderRadius: 22, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
  const recoverPill = { ...pill, background: "rgba(90,158,111,0.14)", border: "1px solid rgba(90,158,111,0.32)", color: "#5a9e6f" };
  const ghostPill = { ...pill, background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "#8a8a8a" };

  if (editing !== null) {
    const tm = typeMeta(form.type);
    return (
      <div>
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 9, fontWeight: 500 }}>유형</div>
        <div style={{ display: "flex", gap: 7, marginBottom: 16, flexWrap: "wrap" }}>
          {HEALTH_TYPES.map((t) => {
            const on = form.type === t.key;
            return (
              <span key={t.key} onClick={() => setForm({ ...form, type: t.key })}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", background: on ? t.color : "#2a2a2a", color: on ? "#141414" : "#8a8a8a", fontWeight: on ? 600 : 400, border: `1px solid ${on ? t.color : "rgba(255,255,255,0.08)"}` }}>
                {t.ico} {t.name}
              </span>
            );
          })}
        </div>

        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 9, fontWeight: 500 }}>제목 (부위·증상)</div>
        <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="예: 손목·다리 / 장염" style={{ ...inputStyle, marginBottom: 16 }} />

        {/* 기간 — 시작일 + (선택)종료일 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 9, fontWeight: 500 }}>언제부터</div>
          <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={dateStyle} />

          {endOpen ? (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ fontSize: 11.5, color: "#5a9e6f", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5a9e6f" }} />종료일
                </span>
                <span onClick={removeEnd} style={{ fontSize: 11, color: "#8a8a8a", cursor: "pointer" }}>✕ 제거</span>
              </div>
              <input type="date" value={form.end || ""} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} style={{ ...dateStyle, borderColor: "rgba(90,158,111,0.4)" }} />
            </div>
          ) : form.end ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "rgba(90,158,111,0.1)", border: "1px solid rgba(90,158,111,0.28)", borderRadius: 11, marginTop: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "#5a9e6f" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5a9e6f" }} />
                {form.end < todayStr ? `${form.end}에 종료됨` : form.end === todayStr ? "오늘 회복함" : `${form.end}까지`}
              </span>
              <span style={{ display: "flex", gap: 13 }}>
                <span onClick={() => setEndOpen(true)} style={{ fontSize: 11, color: "#8a8a8a", cursor: "pointer" }}>수정</span>
                <span onClick={removeEnd} style={{ fontSize: 11, color: "#8a8a8a", cursor: "pointer" }}>제거</span>
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {editing !== "new" && <button onClick={recoverToday} style={recoverPill}>✓ 오늘 회복</button>}
              <button onClick={openEnd} style={ghostPill}>＋ 종료일{editing !== "new" ? " 지정" : ""}</button>
            </div>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 9, fontWeight: 500 }}>메모 (선택)</div>
        <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="예: 자전거 낙상. 자전거·조깅 중단, 상체만 가능." style={{ ...inputStyle, marginBottom: 16, resize: "vertical" }} />

        <div onClick={() => setForm({ ...form, exclude: !form.exclude })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", background: "#232323", border: `1px solid ${form.exclude ? "rgba(207,106,106,0.4)" : "rgba(255,255,255,0.09)"}`, borderRadius: 11, marginBottom: 18, cursor: "pointer" }}>
          <div style={{ flex: 1, paddingRight: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>이 기간 계산에서 제외</div>
            <div style={{ fontSize: 10.5, color: "#707070", marginTop: 2, lineHeight: 1.45 }}>장염·단식 등으로 인한 가짜 체중 변화가 적응형 유지칼로리를 왜곡하지 않게</div>
          </div>
          <div style={{ width: 42, height: 24, borderRadius: 12, background: form.exclude ? "#cf6a6a" : "#3a3a3a", position: "relative", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", left: form.exclude ? 21 : 3 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={cancel} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 11, color: "#8a8a8a", fontSize: 13, cursor: "pointer" }}>취소</button>
          <button onClick={save} disabled={!form.label.trim()} style={{ flex: 2, padding: 12, background: form.label.trim() ? tm.color : "#333", border: "none", borderRadius: 11, color: "#141414", fontSize: 13, fontWeight: 600, cursor: form.label.trim() ? "pointer" : "default", opacity: form.label.trim() ? 1 : 0.6 }}>저장</button>
        </div>
        {editing !== "new" && (
          <div onClick={() => remove(form.id)} style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: "#e05252", cursor: "pointer" }}>이 기록 삭제</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <button onClick={openNew} style={{ width: "100%", padding: 12, background: "rgba(90,158,111,0.1)", border: "1px dashed rgba(90,158,111,0.4)", borderRadius: 12, color: "#5a9e6f", fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 14 }}>+ 컨디션 기록 추가</button>

      {ordered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#707070", fontSize: 12, padding: "24px 0", lineHeight: 1.6 }}>
          부상·질병·휴식을 기록해두면<br />달력에 표시되고, 필요하면 계산에서 제외돼요.
        </div>
      ) : (
        ordered.map((ev) => {
          const tm = typeMeta(ev.type);
          const active = dateInEvent(todayStr, ev);
          const openEnded = !ev.end;
          const days = eventDays(ev, todayStr);
          return (
            <div key={ev.id} onClick={() => openEdit(ev)} style={{ display: "flex", gap: 12, padding: 12, background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, marginBottom: 9, cursor: "pointer", alignItems: "center" }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: tm.color + "26", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{tm.ico}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{ev.label || tm.name}</span>
                  {active
                    ? (openEnded
                        ? <span style={{ fontSize: 9.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: tm.color + "26", color: tm.color }}>진행중 {days}일째</span>
                        : <span style={{ fontSize: 9.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: "rgba(90,158,111,0.15)", color: "#5a9e6f" }}>{ev.end}까지</span>)
                    : <span style={{ fontSize: 9.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: "rgba(255,255,255,0.06)", color: "#8a8a8a" }}>종료</span>}
                  {ev.exclude && <span style={{ fontSize: 9.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: "rgba(207,106,106,0.15)", color: "#cf6a6a" }}>계산 제외</span>}
                </div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 3 }}>{tm.name} · {ev.start}{ev.end ? ` ~ ${ev.end}` : "부터"} · {days}일{active && openEnded ? "째" : ""}</div>
                {ev.note && <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 5, lineHeight: 1.45 }}>{ev.note}</div>}
              </div>
              {openEnded
                ? <button onClick={(e) => recover(ev, e)} style={{ fontSize: 11, fontWeight: 600, color: "#5a9e6f", background: "rgba(90,158,111,0.14)", border: "1px solid rgba(90,158,111,0.4)", borderRadius: 8, padding: "7px 11px", whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 }}>✓ 회복</button>
                : <span onClick={(e) => reopen(ev, e)} style={{ fontSize: 10.5, color: "#707070", whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0, textDecoration: "underline" }}>되돌리기</span>}
            </div>
          );
        })
      )}
    </div>
  );
}
