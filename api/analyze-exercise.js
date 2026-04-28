// api/analyze-exercise.js — Vercel Serverless Function
// Claude API를 호출하여 운동의 MET 계수를 분석합니다.
// API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에서 가져옵니다.

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `운동의 MET(대사당량) 계수를 분석해주세요. 반드시 아래 JSON 형식만 반환하고, 다른 텍스트는 절대 포함하지 마세요.

운동: "${query.trim()}"

규칙:
- 강도별로 2~3개 결과를 배열로 반환
- MET 값은 Compendium of Physical Activities 기준
- MET는 소수점 첫째자리까지 (예: 5.0, 8.5)
- 강도 라벨: "가벼움", "보통", "격렬" 중 해당하는 것만
- memo에는 해당 강도의 구체적 설명 (예: "천천히, 휴식 많음")
- 사용자가 강도를 명시했으면 해당 강도 1개만 반환해도 됨
- 잘 모르는 운동이면 가장 유사한 운동 기준으로 추정

JSON 형식 (배열):
[{"n":"운동이름(강도)","m":MET값,"memo":"설명","intensity":"가벼움|보통|격렬"}]`
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", response.status, errText);
      return res.status(502).json({ error: "AI 분석 실패", detail: response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // JSON 배열 추출
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // 단일 객체인 경우 배열로 감싸기
      const objMatch = text.match(/\{[^}]+\}/);
      if (!objMatch) {
        return res.status(500).json({ error: "AI 응답 파싱 실패", raw: text });
      }
      const single = JSON.parse(objMatch[0]);
      if (!single.n || typeof single.m !== "number") {
        return res.status(500).json({ error: "잘못된 운동 데이터", raw: text });
      }
      return res.status(200).json({ success: true, exercises: [single] });
    }

    const exercises = JSON.parse(jsonMatch[0]);

    // 유효성 검증 및 필터링
    const valid = exercises.filter(ex => {
      if (!ex.n || typeof ex.m !== "number") return false;
      // MET 범위 검증 (1.0 ~ 23.0)
      if (ex.m < 1.0 || ex.m > 23.0) return false;
      return true;
    });

    if (valid.length === 0) {
      return res.status(500).json({ error: "유효한 운동 데이터 없음", raw: text });
    }

    // MET 값 소수점 1자리 정리
    valid.forEach(ex => { ex.m = Math.round(ex.m * 10) / 10; });

    return res.status(200).json({ success: true, exercises: valid });
  } catch (e) {
    console.error("analyze-exercise error:", e);
    return res.status(500).json({ error: "서버 오류", message: e.message });
  }
}
