// api/analyze-food.js — Vercel Serverless Function
// Claude API를 호출하여 음식의 영양성분을 분석합니다.
// 텍스트 쿼리 또는 사진(base64) 입력을 모두 지원합니다.
// API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에서 가져옵니다.

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { query, image, mediaType } = req.body;
  const isPhoto = !!image;

  if (!isPhoto && (!query || !query.trim())) {
    return res.status(400).json({ error: "query or image is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    // 사진 분석 vs 텍스트 분석 프롬프트 분기
    let userContent;
    if (isPhoto) {
      userContent = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType || "image/jpeg", data: image }
        },
        {
          type: "text",
          text: `이 사진 속 음식들의 영양성분을 분석해주세요. 반드시 아래 JSON 배열 형식만 반환하고, 다른 텍스트는 절대 포함하지 마세요.

규칙:
- 사진에 보이는 모든 음식을 각각 분석
- 각 음식의 중량(g)을 접시/그릇/수저 크기를 참고하여 추정
- 숫자는 소수점 없이 정수로
- 한국어로 음식 이름 작성
- 반찬류(김치, 깍두기 등)도 포함

JSON 배열 형식 (반드시 [ ]로 감싸기):
[{"n":"음식이름","u":"1인분","g":추정중량g,"p":단백질g,"c":탄수화물g,"f":지방g,"k":칼로리kcal}]`
        }
      ];
    } else {
      userContent = `음식의 영양성분을 분석해주세요. 반드시 아래 JSON 형식만 반환하고, 다른 텍스트는 절대 포함하지 마세요.

음식: "${query.trim()}"

규칙:
- 사용자가 입력한 단위 그대로 기준으로 계산 (예: "1개", "100g", "1그릇")
- 단위가 없으면 일반적인 1인분 기준
- 숫자는 소수점 없이 정수로
- 브랜드 제품이면 해당 브랜드 기준, 모르면 일반 제품 기준

JSON 형식:
{"n":"음식이름 단위","u":"단위","p":단백질g,"c":탄수화물g,"f":지방g,"k":칼로리kcal}`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: isPhoto ? 800 : 300,
        messages: [{ role: "user", content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", response.status, errText);
      return res.status(502).json({ error: "AI 분석 실패", detail: response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    if (isPhoto) {
      // 사진 분석: JSON 배열 파싱
      const arrMatch = text.match(/\[[\s\S]*\]/);
      if (!arrMatch) {
        // 단일 객체도 시도
        const objMatch = text.match(/\{[^}]+\}/);
        if (objMatch) {
          const single = JSON.parse(objMatch[0]);
          const calcK = single.p * 4 + single.c * 4 + single.f * 9;
          if (!single.k || Math.abs(single.k - calcK) > calcK * 0.3) single.k = calcK;
          return res.status(200).json({ success: true, foods: [single], mode: "photo" });
        }
        return res.status(500).json({ error: "AI 응답 파싱 실패", raw: text });
      }

      const foods = JSON.parse(arrMatch[0]);
      // 각 음식의 칼로리 검증
      const validated = foods.filter(f => f.n && typeof f.p === "number").map(f => {
        const calcK = f.p * 4 + f.c * 4 + f.f * 9;
        if (!f.k || Math.abs(f.k - calcK) > calcK * 0.3) f.k = calcK;
        return f;
      });

      return res.status(200).json({ success: true, foods: validated, mode: "photo" });
    } else {
      // 텍스트 분석: 기존 로직
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "AI 응답 파싱 실패", raw: text });
      }

      const food = JSON.parse(jsonMatch[0]);

      if (!food.n || typeof food.p !== "number" || typeof food.c !== "number" || typeof food.f !== "number") {
        return res.status(500).json({ error: "잘못된 영양성분 데이터", raw: text });
      }

      const calcK = food.p * 4 + food.c * 4 + food.f * 9;
      if (!food.k || Math.abs(food.k - calcK) > calcK * 0.3) {
        food.k = calcK;
      }

      return res.status(200).json({ success: true, food });
    }
  } catch (e) {
    console.error("analyze-food error:", e);
    return res.status(500).json({ error: "서버 오류", message: e.message });
  }
}
