export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { query, resultsMap, contextData } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    let combined = "";
    if (resultsMap) {
      for (const [k, v] of Object.entries(resultsMap)) {
        combined += `[${k}]: ${v.substring(0, 400)}\n\n`;
      }
    }

    let ctxStr = "";
    if (contextData && contextData.quote) {
      const q = contextData.quote;
      ctxStr = `[현재가: ${q.c || 0}, 변동: ${q.dp || 0}%]\n`;
    }

    const sys = "당신은 수석 투자 전략가입니다. 여러 전문가의 분석을 종합하여 최종 투자 의견을 submit_verdict 도구로 제출하세요. 에이전트 간 의견이 충돌하는 경우 conflicts 필드에 반드시 기록하세요.";
    const prompt = `분석 주제: ${query} ${ctxStr}\n\n[에이전트 분석 결과]\n${combined}`;

    const schema = {
      type: "object",
      required: ["verdict", "confidence", "summary", "upside", "downside", "timeframe", "conflicts"],
      properties: {
        verdict: { type: "string", enum: ["매수", "보유", "매도", "관망"], description: "최종 투자 의견" },
        confidence: { type: "string", enum: ["높음", "보통", "낮음"], description: "분석 확신도" },
        summary: { type: "string", description: "2문장 이내 종합 의견" },
        upside: { type: "string", description: "주요 상승 촉매 요인" },
        downside: { type: "string", description: "주요 하락 위험 요인" },
        timeframe: { type: "string", enum: ["단기(1-3개월)", "중기(3-6개월)", "장기(6개월+)"], description: "분석 시계" },
        conflicts: {
          type: "array",
          description: "의견이 충돌하는 에이전트 쌍 목록 (없으면 빈 배열)",
          items: {
            type: "object",
            required: ["agents", "reason"],
            properties: {
              agents: { type: "array", items: { type: "string" }, description: "충돌하는 에이전트 키 (예: [\"technical\", \"risk\"])" },
              reason: { type: "string", description: "충돌 이유" }
            }
          }
        }
      }
    };

    let lastErr = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            temperature: 0.2,
            system: sys,
            tools: [{ name: "submit_verdict", description: "5개 에이전트 분석을 종합한 최종 투자 의견을 구조화된 형식으로 제출", input_schema: schema }],
            tool_choice: { type: "tool", name: "submit_verdict" },
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (!response.ok) {
          lastErr = await response.text();
          continue;
        }

        const data = await response.json();
        const toolUse = data.content.find(b => b.type === "tool_use");
        if (toolUse && toolUse.input) {
          return res.status(200).json({ data: toolUse.input });
        }
        lastErr = "No tool_use block in Claude response";
      } catch (e) {
        lastErr = e.message;
      }
    }

    res.status(500).json({ error: `Synthesizer failed after 2 attempts: ${lastErr}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
