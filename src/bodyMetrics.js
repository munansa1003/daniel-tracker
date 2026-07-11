// 체성분 파생 지표 — BodyTab 렌더 인라인에서 추출한 순수 함수 (firebase 의존 없음).
// 수식·반올림·폴백(latest 없으면 0, prev 없으면 null)은 기존 인라인과 동일해야 하며
// 골든셋(__tests__/golden.test.js)이 표준 시료로 이 값들을 고정한다.
// - bmi: 체질량지수, bmr: Mifflin-St Jeor 기초대사량
// - fatMass/leanMass: 체지방량/제지방량(kg)
// - idealWeight(=stdWeight): BMI 22 표준체중, weightAdj: 표준까지의 조절량(인바디 '체중 조절')
// - stdMuscle: 표준 골격근(키×0.195), stdFatPct: 표준 체지방률(15%)
// - dW/dM/dF/dS: 직전 측정 대비 체중/골격근/체지방률/점수 변화
export function bodyMetrics(latest, prev, { height = 175, age = 35 } = {}) {
  const ht = height;
  const bmi = latest ? Math.round(latest.weight / ((ht / 100) ** 2) * 10) / 10 : 0;
  const bmr = latest ? Math.round(10 * latest.weight + 6.25 * ht - 5 * age + 5) : 0;
  const fatMass = latest ? Math.round(latest.weight * latest.fatPct / 100 * 10) / 10 : 0;
  const leanMass = latest ? Math.round((latest.weight - fatMass) * 10) / 10 : 0;
  const idealWeight = Math.round(22 * (ht / 100) ** 2 * 10) / 10;
  const weightAdj = latest ? Math.round((idealWeight - latest.weight) * 10) / 10 : 0;

  const stdWeight = idealWeight;
  const stdMuscle = Math.round(ht * 0.195 * 10) / 10;
  const stdFatPct = 15;

  const dW = prev && latest ? Math.round((latest.weight - prev.weight) * 10) / 10 : null;
  const dM = prev && latest ? Math.round((latest.muscle - prev.muscle) * 10) / 10 : null;
  const dF = prev && latest ? Math.round((latest.fatPct - prev.fatPct) * 10) / 10 : null;
  const dS = prev && latest ? (latest.score || 0) - (prev.score || 0) : null;

  return { bmi, bmr, fatMass, leanMass, idealWeight, weightAdj, stdWeight, stdMuscle, stdFatPct, dW, dM, dF, dS };
}
