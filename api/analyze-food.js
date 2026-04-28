// api/analyze-food.js — Vercel Serverless Function
// Claude API를 호출하여 음식의 영양성분을 분석합니다.
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
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `음식의 영양성분을 분석해주세요. 반드시 아래 JSON 형식만 반환하고, 다른 텍스트는 절대 포함하지 마세요.

음식: "${query.trim()}"

규칙:
- 사용자가 입력한 단위 그대로 기준으로 계산 (예: "1개", "100g", "1그릇")
- 단위가 없으면 일반적인 1인분 기준
- 숫자는 소수점 없이 정수로
- 브랜드 제품이면 해당 브랜드 기준, 모르면 일반 제품 기준

JSON 형식:
{"n":"음식이름 단위","u":"단위","p":단백질g,"c":탄수화물g,"f":지방g,"k":칼로리kcal}`
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

    // JSON 추출 (텍스트에서 {} 부분만)
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "AI 응답 파싱 실패", raw: text });
    }

    const food = JSON.parse(jsonMatch[0]);

    // 유효성 검증
    if (!food.n || typeof food.p !== "number" || typeof food.c !== "number" || typeof food.f !== "number") {
      return res.status(500).json({ error: "잘못된 영양성분 데이터", raw: text });
    }

    // 칼로리 자동 계산 (AI 값과 비교)
    const calcK = food.p * 4 + food.c * 4 + food.f * 9;
    if (!food.k || Math.abs(food.k - calcK) > calcK * 0.3) {
      food.k = calcK;
    }

    return res.status(200).json({ success: true, food });
  } catch (e) {
    console.error("analyze-food error:", e);
    return res.status(500).json({ error: "서버 오류", message: e.message });
  }
}
