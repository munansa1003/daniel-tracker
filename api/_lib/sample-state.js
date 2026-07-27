// api/_lib/sample-state.js — 공유 뷰 Phase 1 테스트용 가상 상태
// (_lib 아래라 Vercel 라우트로 노출되지 않음)
//
// 실제 사용자 데이터는 일절 포함하지 않는다. 형태만 src/__tests__/analysis-export.test.js의
// state() 픽스처와 동일하게 맞춰, buildAnalysisPackage가 실데이터와 같은 경로를 타게 한다.
// user는 height/age 수준만 — 이름·식별정보 없음.

const DAY = 86400000;
const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// 최근 14일(오늘 포함) 가상 기록 생성 — 요청 시점 기준이라 언제 열어도 "최근 14일"이 채워진다.
function buildDays(todayStr) {
  const today = new Date(todayStr + "T12:00:00");
  const days = {};
  // 결정적 변주(요일 기반) — 랜덤 없이 매번 같은 값이 나오게
  const menus = [
    [{ n: "오트밀 100g", k: 380, p: 13, c: 66, f: 7, serving: 1, hour: 8 },
     { n: "닭가슴살 100g", k: 165, p: 31, c: 0, f: 3, serving: 1.5, hour: 12 },
     { n: "현미밥 210g", k: 310, p: 6, c: 68, f: 2, serving: 1, hour: 12 },
     { n: "연어구이 100g", k: 280, p: 34, c: 0, f: 16, serving: 1, hour: 19 },
     { n: "그릭요거트 200g(무가당)", k: 130, p: 20, c: 9, f: 1, serving: 1, hour: 21 }],
    [{ n: "달걀스크램블 (달걀2개)", k: 200, p: 14, c: 2, f: 15, serving: 1, hour: 8 },
     { n: "구내식당 1끼", k: 720, p: 30, c: 95, f: 22, serving: 1, hour: 12 },
     { n: "두부 150g", k: 130, p: 14, c: 4, f: 8, serving: 1, hour: 19 },
     { n: "고구마 200g", k: 260, p: 3, c: 60, f: 0, serving: 1, hour: 19 }],
    [{ n: "김밥", k: 480, p: 12, c: 78, f: 12, serving: 1, hour: 12 },
     { n: "닭갈비", k: 620, p: 38, c: 30, f: 36, serving: 1, hour: 19 },
     { n: "바나나", k: 105, p: 1, c: 27, f: 0, serving: 1, hour: 16 }],
  ];
  const workouts = [
    [{ n: "러닝 5분30초", kcal: 320, duration: 30, m: 11.5, hour: 7 }],
    [{ n: "스쿼트", kcal: 180, duration: 40, m: 5, hour: 19 },
     { n: "벤치프레스(중강도)", kcal: 150, duration: 30, m: 6, hour: 19 }],
    [{ n: "걷기", kcal: 140, duration: 35, m: 4, hour: 21 }],
    [], // 휴식일
  ];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY);
    const ds = fmt(d);
    const dow = d.getDay();
    days[ds] = {
      mode: "cut",
      meals: menus[i % menus.length],
      exercises: workouts[dow % workouts.length],
    };
  }
  return days;
}

function buildBodyLog(todayStr) {
  const today = new Date(todayStr + "T12:00:00");
  // 주 2회 측정 4건 — 완만한 감량 + 골격근 유지(분석 대상이 되는 형태)
  const pts = [
    { back: 12, weight: 78.2, muscle: 39.0, fatPct: 22.1, score: 85 },
    { back: 9, weight: 78.0, muscle: 39.1, fatPct: 21.9, score: 86 },
    { back: 5, weight: 77.7, muscle: 39.1, fatPct: 21.6, score: 87 },
    { back: 2, weight: 77.5, muscle: 39.2, fatPct: 21.4, score: 88 },
  ];
  return pts.map(({ back, ...rest }) => ({ date: fmt(new Date(today.getTime() - back * DAY)), ...rest }));
}

// 요청 시점(todayStr) 기준 가상 상태 — targets는 utils.calcTargets 산출값과 같은 형태의 고정값
// opts.injectName: 테스트가 HTML 이스케이프를 검증할 때만 사용(오늘 날짜 음식명에 주입)
export function sampleState(todayStr, opts = {}) {
  const targetsByMode = {
    cut: { k: 1570, p: 170, c: 119, f: 46, weight: 77 },
    maintain: { k: 1995, p: 170, c: 165, f: 46, weight: 77 },
  };
  const today = new Date(todayStr + "T12:00:00");
  const allDays = buildDays(todayStr);
  if (opts.injectName && allDays[todayStr]) {
    allDays[todayStr] = {
      ...allDays[todayStr],
      meals: [{ n: opts.injectName, k: 500, p: 30, c: 60, f: 15, serving: 1, hour: 12 }],
    };
  }
  return {
    allDays,
    bodyLog: buildBodyLog(todayStr),
    goals: { mode: "cut" },
    user: { height: 175, age: 42 }, // 이름 등 식별정보 없음
    mode: "cut",
    targets: targetsByMode.cut,
    targetsByMode,
    appAdjust: -55,
    tdeeHistory: [{ from: fmt(new Date(today.getTime() - 30 * DAY)), adjust: -55 }],
    healthEvents: [{
      id: 1, type: "injury", label: "손목 통증",
      start: fmt(new Date(today.getTime() - 7 * DAY)),
      end: fmt(new Date(today.getTime() - 4 * DAY)),
      note: "상체 운동 강도 축소", exclude: false,
    }],
  };
}
