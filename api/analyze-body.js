// api/analyze-body.js — Vercel Serverless Function
// 체성분 변화를 분석하고 AI 코칭 피드백을 제공합니다.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { current, previous, dietSummary, exerciseSummary, goals } = req.body;
  if (!current) return res.status(400).json({ error: "current body data required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  try {
    let prompt = `체성분 변화를 분석하고 한국어로 짧은 코칭 피드백을 주세요. 반드시 아래 JSON 형식만 반환하세요.

현재 측정: 체중 ${current.weight}kg, 골격근량 ${current.muscle}kg, 체지방률 ${current.fatPct}%, 인바디 점수 ${current.score || "없음"}`;

    if (previous) {
      prompt += `\n이전 측정 (${previous.date}): 체중 ${previous.weight}kg, 골격근량 ${previous.muscle}kg, 체지방률 ${previous.fatPct}%`;
    }

    if (dietSummary) {
      prompt += `\n측정 사이 식단: 일평균 단백질 ${dietSummary.avgP}g, 칼로리 ${dietSummary.avgK}kcal, 기록일수 ${dietSummary.days}일`;
    }

    if (exerciseSummary) {
      prompt += `\n측정 사이 운동: 총 ${exerciseSummary.totalSessions}회, 일평균 소모 ${exerciseSummary.avgBurn}kcal`;
    }

    if (goals) {
      prompt += `\n목표: 체중 ${goals.weight}kg, 체지방률 ${goals.fatPct}%, 골격근량 ${goals.muscle}kg`;
    }

    prompt += `\n\nJSON 형식:
{"coaching":"2~3문장 코칭 피드백 (변화 분석 + 식단운동 연계 + 조언)"}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return res.status(502).json({ error: "AI 분석 실패", detail: response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "AI 응답 파싱 실패", raw: text });
    }

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ success: true, coaching: result.coaching || text });
  } catch (e) {
    console.error("analyze-body error:", e);
    return res.status(500).json({ error: "서버 오류", message: e.message });
  }
}
